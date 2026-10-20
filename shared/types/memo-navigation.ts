/** 제목·본문은 저장하지 않는다. 표시할 때 인증된 최신 tree와 ID로 합친다. */
export interface MemoNavigationState {
  recent: string[]
  favorites: string[]
}

export const MAX_RECENT_MEMOS = 20
export const MAX_FAVORITE_MEMOS = 100
