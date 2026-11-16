export type MemoRefreshState =
  | { status: 'idle' | 'refreshing' | 'offline'; refreshedAt: number | null }
  | { status: 'error'; refreshedAt: number | null; message: string }

interface RefreshOptions {
  scope: () => string | null
  online: () => boolean
  visible: () => boolean
  refreshTree: () => Promise<boolean>
  refreshActive: (manual: boolean) => Promise<boolean>
  setState: (state: MemoRefreshState) => void
  message: (error: unknown) => string
  now?: () => number
}

/** 화면 갱신을 공유하고 복귀 이벤트 중복과 이전 로그인 응답을 분리한다. */
export function createMemoRefresh(options: RefreshOptions) {
  const now = options.now ?? Date.now
  let pending: Promise<boolean> | null = null
  let pendingManual = false
  let revision = 0
  let refreshedAt: number | null = null

  function reset() {
    revision++
    pending = null
    refreshedAt = null
    options.setState({ status: 'idle', refreshedAt })
  }

  function refresh(manual = false): Promise<boolean> {
    const scope = options.scope()
    if (!scope) return Promise.resolve(false)
    if (!options.online()) {
      options.setState({ status: 'offline', refreshedAt })
      return Promise.resolve(false)
    }
    if (!manual && !options.visible()) return Promise.resolve(false)
    if (pending) return manual && !pendingManual ? pending.then(() => options.scope() === scope ? refresh(true) : false) : pending
    if (!manual && refreshedAt !== null && now() - refreshedAt < 30_000) return Promise.resolve(true)
    const requestedRevision = ++revision
    const current = () => revision === requestedRevision && options.scope() === scope
    pendingManual = manual
    options.setState({ status: 'refreshing', refreshedAt })
    const result = Promise.resolve().then(async () => {
      if (!current()) return false
      if (!(await options.refreshActive(manual))) {
        if (current()) options.setState({ status: 'error', refreshedAt, message: '현재 입력을 보존한 채 새로고침을 멈췄습니다. 저장 상태를 확인하세요.' })
        return false
      }
      if (!current()) return false
      const loaded = await options.refreshTree()
      if (!current()) return false
      if (!loaded) {
        options.setState({ status: 'error', refreshedAt, message: '목록을 새로고침하지 못했습니다. 다시 시도하세요.' })
        return false
      }
      refreshedAt = now()
      options.setState({ status: 'idle', refreshedAt })
      return true
    }).catch((error: unknown) => {
      if (current()) {
        options.setState(options.online() ? { status: 'error', refreshedAt, message: options.message(error) } : { status: 'offline', refreshedAt })
      }
      return false
    }).finally(() => { if (pending === result) pending = null })
    pending = result
    return result
  }

  return { refresh, reset }
}
