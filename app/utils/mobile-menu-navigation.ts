export interface MenuDestination {
  path: string
  memoId: string | null
}

export interface MenuNavigation {
  open: boolean
  sequence: number
  pending: (MenuDestination & { sequence: number }) | null
}

export function initialMenuNavigation(): MenuNavigation {
  return { open: false, sequence: 0, pending: null }
}

/** 닫기·다시 열기는 이전 화면의 늦은 완료 신호도 취소한다. */
export function setMenuOpen(state: MenuNavigation, open: boolean): MenuNavigation {
  return { open, sequence: state.sequence + 1, pending: null }
}

export function beginMenuNavigation(state: MenuNavigation, destination: MenuDestination): MenuNavigation {
  if (!state.open) return state
  const sequence = state.sequence + 1
  return { open: true, sequence, pending: { ...destination, sequence } }
}

/** 같은 주소를 다시 누르거나 저장 가드가 막으면 원래 문서와 알림을 보여 준다. */
export function failMenuNavigation(state: MenuNavigation, path: string, sequence = state.sequence): MenuNavigation {
  if (state.pending && (state.pending.path !== path || state.pending.sequence !== sequence)) return state
  return setMenuOpen(state, false)
}

/** 원래 화면을 다시 고르면 느린 이동을 취소한다. 이미 준비 중인 목적지를 다시 고르면 기다린다. */
export function duplicateMenuNavigation(state: MenuNavigation, path: string): MenuNavigation {
  if (state.pending?.path === path) return state
  return setMenuOpen(state, false)
}

export function finishMenuNavigation(state: MenuNavigation, destination: MenuDestination, sequence: number): MenuNavigation {
  if (!state.pending || state.pending.sequence !== sequence || state.pending.path !== destination.path) return state
  if (state.pending.memoId !== destination.memoId) return state
  return setMenuOpen(state, false)
}
