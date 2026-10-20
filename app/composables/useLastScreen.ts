import { availableScreen, LAST_SCREEN_KEY, needsScreenTree, readScreen, screenPath, screenScope } from '~/utils/last-screen'

export function useLastScreen() {
  const { session } = useUserSession()
  const { ensure } = useMemoTree()

  function forget() {
    try { localStorage.removeItem(LAST_SCREEN_KEY) } catch { /* 저장소 차단은 기본 화면으로 */ }
  }

  async function available(path: string) {
    if (!needsScreenTree(path)) return true
    try { return availableScreen(path, await ensure()) } catch { return false }
  }

  async function restore() {
    const scope = screenScope(session.value)
    if (!scope) { forget(); return null }
    let raw: string | null
    let path: string | null
    try {
      raw = localStorage.getItem(LAST_SCREEN_KEY)
      path = readScreen(raw, scope)
    } catch { return null }
    if (!path || !(await available(path)) || screenScope(session.value) !== scope) {
      // 이전 검증을 기다리는 사이 새 로그인·새 화면이 기록한 주소는 지우지 않는다.
      if (screenScope(session.value) === scope) {
        try { if (localStorage.getItem(LAST_SCREEN_KEY) === raw) forget() } catch { /* 저장소 차단은 기본 화면으로 */ }
      }
      return null
    }
    return path
  }

  async function remember(fullPath: string, stillCurrent: () => boolean) {
    const scope = screenScope(session.value)
    const path = screenPath(fullPath)
    if (!scope) { forget(); return }
    if (!path || !(await available(path)) || !stillCurrent() || screenScope(session.value) !== scope) return
    try { localStorage.setItem(LAST_SCREEN_KEY, JSON.stringify({ version: 1, scope, path })) } catch { /* 저장소 차단 시 현재 화면은 유지 */ }
  }

  return { restore, remember, forget }
}
