import type { TreeResponse } from '#shared/types/memo'
import { availableScreen, LAST_SCREEN_KEY, needsScreenTree, readScreen, screenPath, screenScope } from '~/utils/last-screen'

export function useLastScreen() {
  const { session } = useUserSession()

  function forget() {
    try { localStorage.removeItem(LAST_SCREEN_KEY) } catch { /* 저장소 차단은 기본 화면으로 */ }
  }

  async function available(path: string) {
    if (!needsScreenTree(path)) return true
    try { return availableScreen(path, await $fetch<TreeResponse>('/api/tree')) } catch { return false }
  }

  async function restore() {
    const scope = screenScope(session.value)
    if (!scope) { forget(); return null }
    let path: string | null
    try { path = readScreen(localStorage.getItem(LAST_SCREEN_KEY), scope) } catch { return null }
    if (!path || !(await available(path)) || screenScope(session.value) !== scope) {
      forget()
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
