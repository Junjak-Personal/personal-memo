import { computed, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Memo } from '#shared/types/memo'
import type { MemoRevision, MemoRevisionSummary } from '#shared/types/memo-history'
import { useMemoHistory } from './useMemoHistory'

interface FetchOptions { method?: string; body?: { baseVersion: string } }
type Fetch = (path: string, options?: FetchOptions) => Promise<unknown>
const revision = (id: string): MemoRevision => ({ id, savedAt: '2026-10-21T09:00:00+09:00', title: id, contentLength: 3, content: `본문 ${id}`, date: null, dateEnd: null, tags: [] })
const summaries = [revision('r1'), revision('r2')] satisfies MemoRevisionSummary[]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('수정 이력의 조회·선택·복원 수명', () => {
  const session = ref<unknown>(null)
  let fetch: ReturnType<typeof vi.fn<Fetch>>
  let flush: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  let onRestored: ReturnType<typeof vi.fn<(memo: Memo) => void>>
  let id: string
  let version: string
  let stops: Array<() => void>

  beforeEach(() => {
    session.value = { id: 'session-one', user: { owner: true }, loggedInAt: 10 }
    id = '메모/인코딩'
    version = 'editor-known-version'
    stops = []
    fetch = vi.fn<Fetch>().mockImplementation(async path => path.endsWith('/history') ? summaries : revision('r1'))
    flush = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
    onRestored = vi.fn<(memo: Memo) => void>()
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('watch', (...args: Parameters<typeof watch>) => {
      const stop = watch(...args)
      stops.push(stop)
      return stop
    })
    vi.stubGlobal('onBeforeUnmount', (stop: () => void) => { stops.push(stop) })
    vi.stubGlobal('useUserSession', () => ({ session }))
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('apiMessage', (_error: unknown, fallback: string) => fallback)
    vi.stubGlobal('apiStatus', (error: { status?: number }) => error.status)
  })
  afterEach(() => {
    for (const stop of stops) stop()
    vi.unstubAllGlobals()
  })

  function setup() {
    return useMemoHistory({ memoId: () => id, version: () => version, flush, onRestored })
  }

  it('현재 입력을 먼저 저장하고 목록·첫 버전을 조회하며 ID를 인코딩한다', async () => {
    const history = setup()
    await history.show()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/memos/%EB%A9%94%EB%AA%A8%2F%EC%9D%B8%EC%BD%94%EB%94%A9/history',
      '/api/memos/%EB%A9%94%EB%AA%A8%2F%EC%9D%B8%EC%BD%94%EB%94%A9/history/r1',
    ])
    expect(history.selected.value?.content).toBe('본문 r1')
    expect(history.loading.value).toBe(false)
    expect(fetch.mock.invocationCallOrder[0]).toBeGreaterThan(flush.mock.invocationCallOrder[0]!)
  })

  it('저장 실패 시 이력을 열어 복원하지 않으며 다시 열기로 재시도할 수 있다', async () => {
    const history = setup()
    flush.mockResolvedValueOnce(false)
    await history.show()
    expect(history.error.value).toContain('저장하지 못했습니다')
    expect(fetch).not.toHaveBeenCalled()
    await history.show()
    expect(history.selected.value?.id).toBe('r1')
    expect(history.error.value).toBe('')
  })

  it('경로 ID 첫 저장 후 바뀐 ID와 편집 버전을 사용한다', async () => {
    const source = ref('p:업무/메모.md')
    const history = useMemoHistory({ memoId: () => source.value, version: () => version, flush, onRestored })
    const permanent = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
    flush.mockImplementationOnce(async () => { source.value = permanent; version = 'new-version'; return true })
    await history.show()
    history.confirming.value = true
    const saved = { id: permanent } as Memo
    fetch.mockResolvedValueOnce(saved)
    await history.restore()
    expect(fetch).toHaveBeenLastCalledWith(`/api/memos/${permanent}/history/r1/restore`, { method: 'POST', body: { baseVersion: 'new-version' } })
    expect(onRestored).toHaveBeenCalledWith(saved)
    expect(history.open.value).toBe(false)
  })

  it('미리보기 연속 선택에서 늦은 이전 응답은 새 선택을 덮지 않는다', async () => {
    const history = setup()
    await history.show()
    const old = deferred<MemoRevision>()
    fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(revision('r2'))
    const first = history.select('r1')
    await history.select('r2')
    old.resolve(revision('r1'))
    await first
    expect(history.selected.value?.id).toBe('r2')
  })

  it('다른 버전을 기다리는 동안 이전 미리보기를 보존하되 복원은 보내지 않는다', async () => {
    const history = setup()
    await history.show()
    const pending = deferred<MemoRevision>()
    fetch.mockReturnValueOnce(pending.promise)
    const selecting = history.select('r2')
    expect(history.selected.value?.id).toBe('r1')
    expect(history.selecting.value).toBe(true)
    history.confirming.value = true
    await history.restore()
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    pending.resolve(revision('r2'))
    await selecting
    expect(history.selected.value?.id).toBe('r2')
  })

  it('동일 메모 재조회 중 목록·본문을 유지하고 응답이 없을 때 복원하지 않는다', async () => {
    const history = setup()
    await history.show()
    const pending = deferred<MemoRevisionSummary[]>()
    fetch.mockReturnValueOnce(pending.promise)
    const refreshing = history.show()
    expect(history.revisions.value).toEqual(summaries)
    expect(history.selected.value?.id).toBe('r1')
    history.confirming.value = true
    await history.restore()
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    pending.resolve(summaries)
    await refreshing
    expect(history.loading.value).toBe(false)
    expect(history.selected.value?.id).toBe('r1')
  })

  it('닫은 뒤 늦게 온 본문과 다시 열기 전 목록을 버린다', async () => {
    const history = setup()
    const old = deferred<MemoRevisionSummary[]>()
    fetch.mockReturnValueOnce(old.promise)
    const showing = history.show()
    await Promise.resolve()
    history.close()
    old.resolve(summaries)
    await showing
    expect(history.revisions.value).toEqual([])
    expect(history.selected.value).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('세션이 바뀌면 보이는 원문도 즉시 지우고 이전 응답을 버린다', async () => {
    const history = setup()
    await history.show()
    const old = deferred<MemoRevision>()
    fetch.mockReturnValueOnce(old.promise)
    const selecting = history.select('r2')
    session.value = { id: 'session-two', user: { owner: true }, loggedInAt: 20 }
    expect(history.open.value).toBe(false)
    expect(history.revisions.value).toEqual([])
    old.resolve(revision('r2'))
    await selecting
    expect(history.selected.value).toBeNull()
  })


  it('다른 메모로 이동하면 기존 이력을 즉시 지우고 늦은 선택 응답을 버린다', async () => {
    const source = ref('original')
    const history = useMemoHistory({ memoId: () => source.value, version: () => version, flush, onRestored })
    await history.show()
    const pending = deferred<MemoRevision>()
    fetch.mockReturnValueOnce(pending.promise)
    const selecting = history.select('r2')
    source.value = 'another'
    expect(history.open.value).toBe(false)
    expect(history.selected.value).toBeNull()
    expect(history.revisions.value).toEqual([])
    pending.resolve(revision('r2'))
    await selecting
    expect(history.selected.value).toBeNull()
  })

  it('명시 확인 전 복원을 보내지 않고 저장한 편집 버전으로만 복원한다', async () => {
    const history = setup()
    await history.show()
    await history.restore()
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    history.confirming.value = true
    fetch.mockRejectedValueOnce({ status: 409 })
    await history.restore()
    expect(history.error.value).toContain('다른 곳에서 먼저 수정')
    expect(onRestored).not.toHaveBeenCalled()
    expect(history.open.value).toBe(true)
    expect(history.confirming.value).toBe(false)
  })

  it('열어 둔 동안 편집 버전이 바뀌면 재확인을 요구하며 자동 최신 버전 덮어쓰기를 하지 않는다', async () => {
    const history = setup()
    await history.show()
    history.confirming.value = true
    version = 'changed-after-preview'
    await history.restore()
    expect(history.error.value).toContain('현재 내용이 바뀌었습니다')
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
  })

  it('복원 중 중복 입력을 무시하고 세션 전환 후 늦은 성공이 다른 화면을 새로 세우지 않는다', async () => {
    const history = setup()
    await history.show()
    history.confirming.value = true
    const pending = deferred<Memo>()
    fetch.mockReturnValueOnce(pending.promise)
    const restoring = history.restore()
    await Promise.resolve()
    await history.restore()
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    session.value = null
    pending.resolve({ id } as Memo)
    await restoring
    expect(onRestored).not.toHaveBeenCalled()
  })

  it('본문 조회 실패를 표시하고 같은 버전을 다시 선택해 복구한다', async () => {
    const history = setup()
    await history.show()
    fetch.mockRejectedValueOnce(new Error('offline'))
    await history.select('r2')
    expect(history.error.value).toContain('이 버전을 불러오지 못했습니다')
    expect(history.selected.value?.id).toBe('r1')
    expect(history.selectedReady.value).toBe(false)
    history.confirming.value = true
    await history.restore()
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0)
    fetch.mockResolvedValueOnce(revision('r2'))
    await history.select('r2')
    expect(history.error.value).toBe('')
    expect(history.selected.value?.id).toBe('r2')
  })
})
