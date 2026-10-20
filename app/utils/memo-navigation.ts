import type { MemoNavigationState } from '#shared/types/memo-navigation'
import type { SearchHit } from '#shared/types/memo'

interface Options {
  scope: () => string | null
  state: () => MemoNavigationState | null
  setState: (state: MemoNavigationState | null) => void
  setPending: (pending: boolean) => void
  setError: (message: string | null) => void
  load: () => Promise<MemoNavigationState>
  opened: (id: string, previousId?: string) => Promise<MemoNavigationState>
  favorite: (id: string, favorite: boolean) => Promise<MemoNavigationState>
  message: (error: unknown) => string
}

/** 인증 scope와 요청 순서를 함께 관리해 이전 GET이나 다른 로그인 응답이 목록을 덮지 못하게 한다. */
export function createMemoNavigation(options: Options) {
  let scope: string | null | undefined
  let generation = 0
  let tail: Promise<unknown> = Promise.resolve()
  let loading: Promise<MemoNavigationState | null> | null = null
  let loaded = false

  function syncScope() {
    const next = options.scope()
    if (scope === next) return
    scope = next
    generation++
    tail = Promise.resolve()
    loading = null
    loaded = false
    options.setState(null)
    options.setError(null)
    options.setPending(false)
  }

  function run(fetch: () => Promise<MemoNavigationState>): Promise<MemoNavigationState | null> {
    syncScope()
    if (!scope) return Promise.resolve(null)
    const current = generation
    const stillCurrent = () => current === generation && scope === options.scope()
    const task = tail.then(async () => {
      if (!stillCurrent()) return null
      options.setPending(true)
      options.setError(null)
      try {
        const result = await fetch()
        if (!stillCurrent()) return null
        options.setState(result)
        loaded = true
        return result
      } catch (error) {
        if (stillCurrent()) options.setError(options.message(error))
        return null
      } finally {
        if (stillCurrent()) options.setPending(false)
      }
    })
    tail = task
    return task
  }

  function ensure(force = false): Promise<MemoNavigationState | null> {
    syncScope()
    if (!scope) return Promise.resolve(null)
    if (loading) return loading
    if (!force && loaded) return Promise.resolve(options.state())
    const request = run(options.load)
    loading = request
    void request.finally(() => { if (loading === request) loading = null })
    return request
  }

  function recordOpened(id: string, previousId?: string) {
    return run(() => options.opened(id, previousId))
  }

  async function toggleFavorite(id: string) {
    // 아직 목록을 받지 못했다면 추가/해제를 추측하지 않는다. 대기열 안에서는 최신 목록을 읽는다.
    const current = options.scope()
    if (!(await ensure()) || current !== options.scope()) return false
    const result = await run(() => options.favorite(id, !options.state()?.favorites.includes(id)))
    return result !== null
  }

  return { syncScope, ensure: () => ensure(), refresh: () => ensure(true), recordOpened, toggleFavorite }
}

export function quickSwitchKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing' | 'repeat'>) {
  return !event.isComposing && !event.repeat && !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
}

export function quickSelection(key: string, selected: number, count: number) {
  if (!count) return -1
  if (key === 'ArrowDown') return (selected + 1 + count) % count
  if (key === 'ArrowUp') return (selected - 1 + count) % count
  return Math.min(Math.max(selected, 0), count - 1)
}

export interface MemoQuickSearchState {
  results: SearchHit[]
  loading: boolean
  error: string | null
}

/** 닫힌 창·이전 검색·이전 로그인에서 늦게 도착한 본문 발췌를 표시하지 않는다. */
export function createMemoQuickSearch(options: {
  scope: () => string | null
  active: () => boolean
  fetch: (query: string, signal: AbortSignal) => Promise<SearchHit[]>
  setState: (state: MemoQuickSearchState) => void
  message: (error: unknown) => string
}) {
  let sequence = 0
  let request: AbortController | null = null

  function reset() {
    sequence++
    request?.abort()
    request = null
    options.setState({ results: [], loading: false, error: null })
  }

  async function search(query: string) {
    reset()
    const scope = options.scope()
    if (!query.trim() || !scope || !options.active()) return
    const current = sequence
    const controller = new AbortController()
    request = controller
    const valid = () => current === sequence && scope === options.scope() && options.active()
    options.setState({ results: [], loading: true, error: null })
    try {
      const results = await options.fetch(query.trim().slice(0, 200), controller.signal)
      if (valid()) options.setState({ results: results.filter((memo) => !memo.unreadable), loading: false, error: null })
    } catch (error) {
      if (valid()) options.setState({ results: [], loading: false, error: options.message(error) })
    } finally {
      if (request === controller) request = null
    }
  }

  return { search, reset }
}
