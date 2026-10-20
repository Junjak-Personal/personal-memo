import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiMessage } from '~/utils/api-error'
import { memoPath } from '~/utils/memo-path'
import { useMemoTrashActions } from './useMemoTrashActions'

type RequestOptions = { method: 'DELETE' } | { method: 'POST'; body: { path: string } }
type TrashRequest = (url: string, options: RequestOptions) => Promise<{ trashPath: string } | { id: string }>
interface Notice {
  title: string
  color?: string
  description?: string
  actions?: Array<{ label: string; color: string; variant: string; onClick: () => void }>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

/** 토스트의 onClick은 기존 UI 계약대로 void다. 요청 뒤의 비동기 동작만 비운다. */
async function flush() {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('메모 메뉴·사이드바의 공통 휴지통 동작', () => {
  let events: string[]
  let fetch: ReturnType<typeof vi.fn<TrashRequest>>
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>
  let add: ReturnType<typeof vi.fn<(notice: Notice) => void>>
  let navigate: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>

  beforeEach(() => {
    events = []
    fetch = vi.fn<TrashRequest>(async (_url, options) => {
      events.push(options.method)
      return { trashPath: '삭제된 메모 (2).md' }
    })
    refresh = vi.fn<() => Promise<void>>(async () => { events.push('refresh') })
    add = vi.fn<(notice: Notice) => void>(() => { events.push('notice') })
    navigate = vi.fn<(path: string) => Promise<void>>(async () => { events.push('navigate') })
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('useMemoTree', () => ({ refresh }))
    vi.stubGlobal('useToast', () => ({ add }))
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('memoPath', memoPath)
    vi.stubGlobal('apiMessage', apiMessage)
  })
  afterEach(() => vi.unstubAllGlobals())

  function undo() {
    const action = add.mock.calls[0]?.[0].actions?.[0]
    expect(action).toMatchObject({ label: '되돌리기', color: 'neutral', variant: 'outline' })
    action!.onClick()
  }

  it('경로 id를 인코딩해 지우고 목록 갱신 뒤 서버가 준 실제 휴지통 경로만 반환한다', async () => {
    const actions = useMemoTrashActions()
    const path = await actions.moveToTrash('p:업무/회의록.md')
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/memos/p%3A%EC%97%85%EB%AC%B4%2F%ED%9A%8C%EC%9D%98%EB%A1%9D.md', { method: 'DELETE' })
    expect(path).toBe('삭제된 메모 (2).md')
    expect(events).toEqual(['DELETE', 'refresh'])
    expect(add).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    actions.notifyMoved(path)
    expect(add.mock.calls[0]?.[0].title).toBe('휴지통으로 옮겼습니다')
  })

  it('갱신이 끝나야 반환해서 호출 화면이 drawer를 닫은 뒤 토스트를 표시할 수 있다', async () => {
    const updated = deferred<void>()
    refresh.mockImplementationOnce(() => updated.promise)
    const actions = useMemoTrashActions()
    let moved = false
    const moving = actions.moveToTrash('one').then(path => { moved = true; return path })
    await flush()
    expect(refresh).toHaveBeenCalledOnce()
    expect(moved).toBe(false)
    expect(add).not.toHaveBeenCalled()
    updated.resolve()
    const path = await moving
    events.push('drawer-close')
    actions.notifyMoved(path)
    expect(events).toEqual(['DELETE', 'drawer-close', 'notice'])
  })

  it('삭제 실패는 호출 화면으로 전달하고 목록·성공 알림·화면 이동을 실행하지 않는다', async () => {
    const error = new Error('삭제 거절')
    fetch.mockRejectedValueOnce(error)
    await expect(useMemoTrashActions().moveToTrash('one')).rejects.toBe(error)
    expect(refresh).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('되돌리기는 실제 휴지통 경로로 복원하고 목록 갱신을 기다린 뒤 복원 메모를 연다', async () => {
    const updated = deferred<void>()
    refresh.mockImplementationOnce(() => updated.promise)
    fetch.mockResolvedValueOnce({ id: 'p:다른 폴더/복원.md' })
    useMemoTrashActions().notifyMoved('업무/회의록 (2).md')
    undo()
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/trash/restore', { method: 'POST', body: { path: '업무/회의록 (2).md' } })
    await flush()
    expect(refresh).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()
    updated.resolve()
    await flush()
    expect(navigate).toHaveBeenCalledExactlyOnceWith(memoPath('p:다른 폴더/복원.md'))
  })

  it('복원 API가 거절되면 기존 서버 문구와 휴지통 안내를 표시하고 이동하지 않는다', async () => {
    fetch.mockRejectedValueOnce({ statusCode: 409, data: { data: { message: '원래 폴더를 사용할 수 없습니다' } } })
    useMemoTrashActions().notifyMoved('업무/회의록 (2).md')
    undo()
    await flush()
    expect(add).toHaveBeenLastCalledWith({ color: 'error', title: '원래 폴더를 사용할 수 없습니다', description: '휴지통 화면에서 복원하세요.' })
    expect(refresh).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('복원 뒤 목록 갱신 오류도 기존 복원 오류 안내로 처리하며 다음 화면은 열지 않는다', async () => {
    fetch.mockResolvedValueOnce({ id: 'restored' })
    refresh.mockRejectedValueOnce(new Error('목록 거절'))
    useMemoTrashActions().notifyMoved('원래 이름 (2).md')
    undo()
    await flush()
    expect(navigate).not.toHaveBeenCalled()
    expect(add).toHaveBeenLastCalledWith({ color: 'error', title: '되돌리지 못했습니다', description: '휴지통 화면에서 복원하세요.' })
  })

  it('복원 후 화면 이동 오류도 동일한 복원 오류 안내를 유지한다', async () => {
    fetch.mockResolvedValueOnce({ id: 'restored' })
    navigate.mockRejectedValueOnce(new Error('청크 수신 실패'))
    useMemoTrashActions().notifyMoved('원래 이름.md')
    undo()
    await flush()
    expect(refresh).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/m/restored')
    expect(add).toHaveBeenLastCalledWith({ color: 'error', title: '되돌리지 못했습니다', description: '휴지통 화면에서 복원하세요.' })
  })
})
