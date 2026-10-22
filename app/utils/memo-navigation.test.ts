import { describe, expect, it, vi } from 'vitest'
import type { MemoNavigationState } from '#shared/types/memo-navigation'
import type { SearchHit } from '#shared/types/memo'
import { createMemoNavigation, createMemoQuickSearch, quickSelection, quickSwitchKey, type MemoQuickSearchState } from './memo-navigation'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((ok, no) => { resolve = ok; reject = no })
  return { promise, resolve, reject }
}

function harness() {
  let scope: string | null = 'one'
  let state: MemoNavigationState | null = null
  let pending = false
  let error: string | null = null
  const load = vi.fn(async (): Promise<MemoNavigationState> => ({ recent: [], favorites: ['a'] }))
  const opened = vi.fn(async (id: string): Promise<MemoNavigationState> => ({ recent: [id], favorites: state?.favorites ?? [] }))
  const favorite = vi.fn(async (id: string, add: boolean): Promise<MemoNavigationState> => ({ recent: state?.recent ?? [], favorites: add ? [id] : [] }))
  const controller = createMemoNavigation({
    scope: () => scope, state: () => state, setState: value => { state = value },
    setPending: value => { pending = value }, setError: value => { error = value }, load, opened, favorite,
    message: () => '실패',
  })
  return { ...controller, load, opened, favorite, scope: (value: string | null) => { scope = value }, state: () => state, pending: () => pending, error: () => error }
}

describe('인증된 최근 메모·즐겨찾기 상태', () => {
  it('첫 목록 요청은 공유하고 받은 뒤 ensure는 재요청하지 않는다', async () => {
    const h = harness()
    await Promise.all([h.ensure(), h.ensure()])
    expect(h.load).toHaveBeenCalledTimes(1)
    await h.ensure()
    expect(h.load).toHaveBeenCalledTimes(1)
    await h.refresh()
    expect(h.load).toHaveBeenCalledTimes(2)
  })

  it('늦은 GET이 뒤따르는 별표/방문 기록을 덮지 않도록 요청 순서를 지킨다', async () => {
    const h = harness()
    const old = deferred<MemoNavigationState>()
    h.load.mockReturnValueOnce(old.promise)
    const loading = h.ensure()
    const opening = h.recordOpened('b')
    await Promise.resolve()
    expect(h.opened).not.toHaveBeenCalled()
    old.resolve({ recent: ['a'], favorites: ['a'] })
    await Promise.all([loading, opening])
    await h.toggleFavorite('a')
    expect(h.state()).toEqual({ recent: ['b'], favorites: [] })
    expect(h.favorite).toHaveBeenCalledWith('a', false)
  })

  it('로그인 전환은 이전 목록을 즉시 지우고 늦은 성공/실패가 새 상태를 덮지 않는다', async () => {
    const h = harness()
    await h.ensure()
    const old = deferred<MemoNavigationState>()
    h.opened.mockReturnValueOnce(old.promise)
    const prior = h.recordOpened('private')
    await Promise.resolve()
    h.scope('two')
    h.syncScope()
    expect(h.state()).toBeNull()
    expect(h.pending()).toBe(false)
    await h.recordOpened('new')
    old.resolve({ recent: ['private'], favorites: ['private'] })
    await prior
    expect(h.state()).toEqual({ recent: ['new'], favorites: [] })
    expect(h.error()).toBeNull()
    h.scope(null)
    h.syncScope()
    expect(h.state()).toBeNull()
    expect(await h.ensure()).toBeNull()
  })

  it('목록을 못 받으면 별표 추가/해제를 추측하지 않고 오류를 남긴다', async () => {
    const h = harness()
    h.load.mockRejectedValueOnce(new Error('offline'))
    expect(await h.toggleFavorite('a')).toBe(false)
    expect(h.favorite).not.toHaveBeenCalled()
    expect(h.error()).toBe('실패')
    expect(h.pending()).toBe(false)
    await h.toggleFavorite('a')
    expect(h.favorite).toHaveBeenCalledWith('a', false)
    expect(h.error()).toBeNull()
  })

  it('이전 로그인에서 대기하던 쓰기는 새 로그인에서 실행하지 않는다', async () => {
    const h = harness()
    const old = deferred<MemoNavigationState>()
    h.load.mockReturnValueOnce(old.promise)
    const loading = h.ensure()
    const queued = h.recordOpened('old')
    h.scope('two')
    h.syncScope()
    old.resolve({ recent: [], favorites: [] })
    await Promise.all([loading, queued])
    expect(h.opened).not.toHaveBeenCalled()
    expect(h.state()).toBeNull()
  })
})

describe('빠른 검색 입력·응답', () => {
  it('⌘K/Ctrl+K만 처리하고 일반 K·조합 중·반복 키는 그대로 둔다', () => {
    const base = { key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, repeat: false }
    expect(quickSwitchKey(base)).toBe(false)
    expect(quickSwitchKey({ ...base, metaKey: true })).toBe(true)
    expect(quickSwitchKey({ ...base, key: 'K', ctrlKey: true })).toBe(true)
    expect(quickSwitchKey({ ...base, metaKey: true, isComposing: true })).toBe(false)
    expect(quickSwitchKey({ ...base, metaKey: true, repeat: true })).toBe(false)
    expect(quickSelection('ArrowUp', 0, 3)).toBe(2)
    expect(quickSelection('ArrowDown', 2, 3)).toBe(0)
    expect(quickSelection('ArrowDown', 0, 0)).toBe(-1)
  })

  it('이전 검색 응답·오류와 닫은 창의 본문은 표시하지 않는다', async () => {
    let scope = 'one'
    let active = true
    let state: MemoQuickSearchState = { results: [], loading: false, error: null, resultsQuery: null }
    const old = deferred<SearchHit[]>()
    const newer = deferred<SearchHit[]>()
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise)
    const search = createMemoQuickSearch({ scope: () => scope, active: () => active, fetch, setState: value => { state = value }, message: () => '실패' })
    const first = search.search('a')
    const second = search.search('b')
    expect(fetch.mock.calls[0]![1].aborted).toBe(true)
    newer.resolve([{ id: 'b', unreadable: false }, { id: 'bad', unreadable: true }] as SearchHit[])
    await second
    old.reject(new Error('old failed'))
    await first
    expect(state.results.map(memo => memo.id)).toEqual(['b'])
    expect(state.error).toBeNull()
    const late = deferred<SearchHit[]>()
    fetch.mockReturnValueOnce(late.promise)
    const third = search.search('private')
    scope = 'two'
    active = false
    search.reset()
    late.resolve([{ id: 'private' }] as SearchHit[])
    await third
    expect(state).toEqual({ results: [], loading: false, error: null, resultsQuery: null })
  })
})

it('재검색을 시작하거나 실패해도 같은 로그인에서 이미 받은 결과를 유지한다', async () => {
  let state: MemoQuickSearchState = { results: [], loading: false, error: null, resultsQuery: null }
  const next = deferred<SearchHit[]>()
  const rows = [{ id: 'kept', unreadable: false }] as SearchHit[]
  const fetch = vi.fn().mockResolvedValueOnce(rows).mockReturnValueOnce(next.promise)
  const search = createMemoQuickSearch({ scope: () => 'one', active: () => true, fetch, setState: value => { state = value }, message: () => '실패' })
  await search.search('first')
  const pending = search.search('second')
  expect(state.loading).toBe(true)
  expect(state.results).toEqual(rows)
  next.reject(new Error('offline'))
  await pending
  expect(state.results).toEqual(rows)
  expect(state.error).toBe('실패')
})

it('debounce와 조합 입력 취소는 기존 목록만 유지하고 대기 응답은 무효화한다', async () => {
  let state: MemoQuickSearchState = { results: [], loading: false, error: null, resultsQuery: null }
  const late = deferred<SearchHit[]>()
  const fetch = vi.fn().mockResolvedValueOnce([{ id: 'kept', unreadable: false }]).mockReturnValueOnce(late.promise)
  const search = createMemoQuickSearch({ scope: () => 'one', active: () => true, fetch, setState: value => { state = value }, message: () => '실패' })
  await search.search('first')
  search.prepare('debounced')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(state).toMatchObject({ loading: true, resultsQuery: 'first', results: [{ id: 'kept' }] })
  const pending = search.search('pending')
  search.cancel()
  expect(state).toMatchObject({ loading: false, resultsQuery: 'first', results: [{ id: 'kept' }] })
  late.resolve([{ id: 'late' }] as SearchHit[])
  await pending
  expect(state.results[0]?.id).toBe('kept')
})

it('정상 빈 결과와 아직 응답이 없는 최초 검색을 구분하고 다른 로그인은 이전 결과를 지운다', async () => {
  let state: MemoQuickSearchState = { results: [], loading: false, error: null, resultsQuery: null }
  let scope = 'one'
  const fetch = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'private', unreadable: false }])
  const search = createMemoQuickSearch({ scope: () => scope, active: () => true, fetch, setState: value => { state = value }, message: () => '실패' })
  search.prepare('first')
  expect(state.resultsQuery).toBeNull()
  await search.search('none')
  expect(state).toMatchObject({ results: [], resultsQuery: 'none', loading: false })
  await search.search('private')
  scope = 'two'
  search.prepare('new login')
  expect(state).toEqual({ results: [], resultsQuery: null, loading: true, error: null })
  search.reset()
  expect(state).toEqual({ results: [], resultsQuery: null, loading: false, error: null })
})
