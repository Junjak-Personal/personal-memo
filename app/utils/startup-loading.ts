export type StartupPhase = 'loading' | 'slow' | 'ready' | 'failed' | 'revealed'

/** 첫 화면에서만 쓴다. 웹 문서 수신과 실제 편집 가능한 화면 준비를 구분한다. */
export function createStartupGate(onReady: (commit: () => boolean) => void) {
  let finished = false
  let mounted = false
  let page = false
  let tree = false
  let needsTree = false
  let memo: string | null = null
  let content: string | null = null

  function canFinish() {
    return !finished && mounted && page && (!needsTree || tree) && (!memo || content === memo)
  }
  function check() {
    if (!canFinish()) return
    onReady(() => {
      // 실제 paint 전 계정·화면이 바뀌면 예정했던 완료 신호를 폐기한다.
      if (!canFinish()) return false
      finished = true
      return true
    })
  }

  return {
    mounted() { mounted = true; check() },
    pagePending() { page = false; memo = null; content = null },
    pageReady(id: string | null, requiresTree: boolean) { page = true; memo = id; needsTree = requiresTree; check() },
    contentReady(id: string) { content = id; check() },
    treePending() { tree = false },
    treeSettled() { tree = true; check() },
    stop() { finished = true },
  }
}

/** 계측에는 URL·ID·본문을 넣지 않는다. ResourceTiming은 그 자리에서 집계만 한다. */
export function startupRequests(entries: Pick<PerformanceResourceTiming, 'name' | 'duration'>[], origin: string) {
  // 관측하지 못한 fetch를 0ms로 표시하면 병목 판단을 잘못하게 되므로 키를 생략한다.
  const result: Partial<Record<'sessionRequests' | 'treeRequests' | 'memoRequests' | 'sessionMs' | 'treeMs' | 'memoMs', number>> = {}
  for (const entry of entries) {
    let url: URL
    try { url = new URL(entry.name) } catch { continue }
    if (url.origin !== origin) continue
    const key = url.pathname === '/api/_auth/session' ? 'session' : url.pathname === '/api/tree' ? 'tree' : /^\/api\/memos\/[^/]+$/.test(url.pathname) ? 'memo' : null
    if (key) {
      result[`${key}Requests`] = (result[`${key}Requests`] ?? 0) + 1
      result[`${key}Ms`] = (result[`${key}Ms`] ?? 0) + Math.round(entry.duration)
    }
  }
  return result
}
