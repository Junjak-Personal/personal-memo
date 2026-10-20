import { ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Memo } from '#shared/types/memo'
import type { MemoTemplate, MemoTemplateSummary } from '#shared/types/memo-templates'
import { useMemoTemplates, useSaveMemoTemplate } from './useMemoTemplates'

type Fetch = (path: string, options?: { method?: string; body?: object }) => Promise<unknown>
const detail = (id: string): MemoTemplate => ({ id, name: `양식 ${id}`, title: `제목 ${id}`, content: '<script>원문</script>', tags: ['업무'], createdAt: 'today', updatedAt: 'today' })
const list = [detail('one'), detail('two')] satisfies MemoTemplateSummary[]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('내 템플릿 모달의 조회·변경·인증 수명', () => {
  const session = ref<unknown>(null)
  let fetch: ReturnType<typeof vi.fn<Fetch>>
  let flush: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  let stops: Array<() => void>
  let id: string
  let version: string
  beforeEach(() => {
    session.value = { id: 'one', user: { owner: true }, loggedInAt: 10 }
    stops = []
    id = 'original'
    version = 'known-version'
    fetch = vi.fn<Fetch>().mockImplementation(async path => path === '/api/templates' ? list : detail(path.split('/').at(-1)!))
    flush = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', (...args: Parameters<typeof watch>) => {
      const stop = watch(...args)
      stops.push(stop)
      return stop
    })
    vi.stubGlobal('onBeforeUnmount', (stop: () => void) => { stops.push(stop) })
    vi.stubGlobal('useUserSession', () => ({ session }))
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('apiMessage', (_e: unknown, fallback: string) => fallback)
    vi.stubGlobal('apiStatus', (e: { status?: number }) => e.status)
  })
  afterEach(() => {
    for (const stop of stops) stop()
    vi.unstubAllGlobals()
  })
  const manager = () => useMemoTemplates({ flush })
  const saver = () => useSaveMemoTemplate({ memoId: () => id, version: () => version, title: () => '원본 제목', flush })

  it('목록과 첫 원문을 조회하고 이전 선택의 늦은 응답을 버린다', async () => {
    const state = manager()
    await state.show()
    expect(state.selected.value?.content).toBe('<script>원문</script>')
    const old = deferred<MemoTemplate>()
    fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail('two'))
    const selecting = state.select('one')
    expect(state.selected.value).toBeNull()
    expect(state.name.value).toBe('')
    await state.select('two')
    old.resolve(detail('one'))
    await selecting
    expect(state.selected.value?.id).toBe('two')
  })

  it('목록 실패·빈 목록을 표시하고 명시적인 다시 열기로 재조회한다', async () => {
    const state = manager()
    fetch.mockRejectedValueOnce(new Error('offline'))
    await state.show()
    expect(state.error.value).toContain('목록을 불러오지 못했습니다')
    fetch.mockResolvedValueOnce([])
    await state.show()
    expect(state.templates.value).toEqual([])
    expect(state.error.value).toBe('')
    expect(state.selected.value).toBeNull()
  })

  it('선택 실패 뒤 이름·원문을 지우고 다시 선택할 수 있다', async () => {
    const state = manager()
    await state.show()
    fetch.mockRejectedValueOnce(new Error('offline'))
    await state.select('two')
    expect(state.selected.value).toBeNull()
    expect(state.name.value).toBe('')
    expect(state.error.value).toContain('템플릿을 불러오지 못했습니다')
    await state.select('two')
    expect(state.selected.value?.id).toBe('two')
  })

  it('이름만 PATCH하며 실패하면 기존 이름과 원문을 유지한다', async () => {
    const state = manager()
    await state.show()
    state.name.value = '  새 이름  '
    fetch.mockRejectedValueOnce(new Error('offline'))
    await state.rename()
    expect(fetch).toHaveBeenLastCalledWith('/api/templates/one', { method: 'PATCH', body: { name: '새 이름' } })
    expect(state.selected.value?.name).toBe('양식 one')
    expect(state.error.value).toContain('목록을 다시 불러와')
    fetch.mockResolvedValueOnce({ ...detail('one'), name: '새 이름' })
    await state.rename()
    expect(state.templates.value[0]?.name).toBe('새 이름')
    expect(state.selected.value?.content).toBe('<script>원문</script>')
  })

  it('이름 비어 있음·200자 초과는 요청하지 않는다', async () => {
    const state = manager()
    await state.show()
    const count = fetch.mock.calls.length
    state.name.value = '  '
    await state.rename()
    state.name.value = '가'.repeat(201)
    await state.rename()
    expect(fetch).toHaveBeenCalledTimes(count)
  })

  it('삭제 취소는 요청하지 않으며 실패 시 템플릿을 숨기지 않는다', async () => {
    const state = manager()
    await state.show()
    await state.remove()
    expect(fetch).toHaveBeenCalledTimes(2)
    state.confirming.value = true
    fetch.mockRejectedValueOnce(new Error('offline'))
    await state.remove()
    expect(state.selected.value?.id).toBe('one')
    expect(state.templates.value).toHaveLength(2)
    fetch.mockResolvedValueOnce({ ok: true })
    await state.remove()
    expect(fetch).toHaveBeenLastCalledWith('/api/templates/one', { method: 'DELETE' })
    expect(state.templates.value.map(item => item.id)).toEqual(['two'])
    expect(state.selected.value).toBeNull()
  })

  it('현재 편집 저장 실패는 생성하지 않고, 생성 요청 실패를 자동 재전송하지 않는다', async () => {
    const state = manager()
    await state.show()
    flush.mockResolvedValueOnce(false)
    expect(await state.create('업무')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await state.create('업무')).toBeNull()
    expect(state.error.value).toContain('이미 만들어졌는지 확인')
    expect(fetch.mock.calls.filter(([, args]) => args?.method === 'POST')).toHaveLength(1)
  })

  it('생성 전에 편집을 저장하고 확인된 생성은 다시 전송하지 않는다', async () => {
    const state = manager()
    await state.show()
    const pending = deferred<Memo>()
    fetch.mockReturnValueOnce(pending.promise)
    const creating = state.create('업무/회의')
    await Promise.resolve()
    expect(await state.create('업무/회의')).toBeNull()
    const memo = { id: 'new-id', title: '복사한 제목' } as Memo
    pending.resolve(memo)
    expect(await creating).toEqual(memo)
    expect(fetch).toHaveBeenLastCalledWith('/api/templates/one/memos', { method: 'POST', body: { folder: '업무/회의' } })
    expect(fetch.mock.invocationCallOrder.at(-1)).toBeGreaterThan(flush.mock.invocationCallOrder[0]!)
    expect(await state.create('업무/회의')).toBeNull()
    expect(state.created.value?.id).toBe('new-id')
  })

  it('계정 전환은 제목·본문·생성 정보를 즉시 지우고 늦은 응답을 버린다', async () => {
    const state = manager()
    await state.show()
    const pending = deferred<Memo>()
    fetch.mockReturnValueOnce(pending.promise)
    const creating = state.create('')
    await Promise.resolve()
    session.value = { id: 'two', user: { owner: true }, loggedInAt: 20 }
    expect(state.open.value).toBe(false)
    expect(state.templates.value).toEqual([])
    expect(state.selected.value).toBeNull()
    expect(state.name.value).toBe('')
    pending.resolve({ id: 'other-account-memo' } as Memo)
    expect(await creating).toBeNull()
    expect(state.created.value).toBeNull()
  })

  it('닫은 뒤 늦은 목록과 unmount 뒤 선택 원문은 반영하지 않는다', async () => {
    const state = manager()
    const pending = deferred<MemoTemplateSummary[]>()
    fetch.mockReturnValueOnce(pending.promise)
    const opening = state.show()
    state.close()
    pending.resolve(list)
    await opening
    expect(state.templates.value).toEqual([])
    await state.show()
    const body = deferred<MemoTemplate>()
    fetch.mockReturnValueOnce(body.promise)
    const selecting = state.select('two')
    stops.at(-1)!()
    body.resolve(detail('two'))
    await selecting
    expect(state.selected.value).toBeNull()
  })

  it('현재 메모 저장 뒤 영구 ID와 새 버전으로 템플릿을 만든다', async () => {
    const state = saver()
    id = 'p:업무/메모.md'
    state.show()
    expect(state.name.value).toBe('원본 제목')
    const permanent = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
    flush.mockImplementationOnce(async () => { id = permanent; version = 'saved-version'; return true })
    expect(await state.save()).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/templates', { method: 'POST', body: { memoId: permanent, name: '원본 제목', baseVersion: 'saved-version' } })
    expect(state.open.value).toBe(false)
  })

  it('템플릿 저장 중 중복 클릭·닫기 후 응답·실패는 자동 저장 재시도를 만들지 않는다', async () => {
    const state = saver()
    state.show()
    const pending = deferred<unknown>()
    fetch.mockReturnValueOnce(pending.promise)
    const saving = state.save()
    await Promise.resolve()
    expect(await state.save()).toBe(false)
    state.close()
    pending.resolve(detail('saved'))
    expect(await saving).toBe(false)
    state.show()
    fetch.mockRejectedValueOnce(new Error('offline'))
    expect(await state.save()).toBe(false)
    expect(state.error.value).toContain('템플릿 목록을 먼저 확인')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('저장 실패·다른 메모로 이동·충돌을 구분하고 미저장 원본을 보내지 않는다', async () => {
    const state = saver()
    state.show()
    flush.mockResolvedValueOnce(false)
    expect(await state.save()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    id = 'another'
    expect(await state.save()).toBe(false)
    expect(state.error.value).toContain('열린 메모가 바뀌었습니다')
    state.show()
    fetch.mockRejectedValueOnce({ status: 409 })
    expect(await state.save()).toBe(false)
    expect(state.error.value).toContain('다른 곳에서 수정')
  })

  it('세션 전환 중 flush가 끝나도 이전 계정 템플릿을 저장하지 않는다', async () => {
    const state = saver()
    state.show()
    const pending = deferred<boolean>()
    flush.mockReturnValueOnce(pending.promise)
    const saving = state.save()
    session.value = null
    expect(state.name.value).toBe('')
    expect(state.open.value).toBe(false)
    pending.resolve(true)
    expect(await saving).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('flush 중 다른 영구 메모로 이동하면 그 메모를 원본으로 바꿔 보내지 않는다', async () => {
    const state = saver()
    state.show()
    flush.mockImplementationOnce(async () => { id = 'another-memo'; return true })
    expect(await state.save()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(state.error.value).toContain('열린 메모가 바뀌었습니다')
  })

  it('이름 변경 중 계정이 바뀌면 이전 계정 응답으로 목록을 채우지 않는다', async () => {
    const state = manager()
    await state.show()
    state.name.value = '이전 계정 이름'
    const pending = deferred<MemoTemplateSummary>()
    fetch.mockReturnValueOnce(pending.promise)
    const renaming = state.rename()
    session.value = null
    pending.resolve({ ...detail('one'), name: '이전 계정 이름' })
    await renaming
    expect(state.templates.value).toEqual([])
    expect(state.selected.value).toBeNull()
    expect(state.name.value).toBe('')
  })
})
