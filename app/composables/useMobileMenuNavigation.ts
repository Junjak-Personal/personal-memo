import type { MenuDestination } from '~/utils/mobile-menu-navigation'
import { beginMenuNavigation, duplicateMenuNavigation, failMenuNavigation, finishMenuNavigation, initialMenuNavigation, setMenuOpen } from '~/utils/mobile-menu-navigation'

/** 메뉴 뒤에서 목적 화면을 준비하고, 준비된 화면 위에서 메뉴만 한 번 밀어 닫는다. */
export function useMobileMenuNavigation() {
  const state = useState('mobile-menu-navigation', initialMenuNavigation)
  const open = computed({
    get: () => state.value.open,
    set: (value: boolean) => { state.value = setMenuOpen(state.value, value) },
  })
  const pending = computed(() => state.value.pending)

  function begin(destination: MenuDestination) {
    state.value = beginMenuNavigation(state.value, destination)
  }

  function finish(destination: MenuDestination, sequence: number) {
    state.value = finishMenuNavigation(state.value, destination, sequence)
  }

  function fail(path: string, sequence?: number) {
    state.value = failMenuNavigation(state.value, path, sequence)
  }

  function duplicate(path: string) {
    state.value = duplicateMenuNavigation(state.value, path)
  }

  /** async setup 전에 캡처한 요청만 완료한다 — 늦게 붙은 이전 문서가 새 이동을 닫지 않게. */
  function memoReady(memoId: string, sequence: number) {
    const target = state.value.pending
    if (target) finish({ path: target.path, memoId }, sequence)
  }

  return { open, pending, begin, finish, fail, duplicate, memoReady }
}
