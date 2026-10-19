import type { TreeResponse } from '#shared/types/memo'
import { isDateString } from '#shared/utils/memo-date'
import { cleanTag, hasTag, MAX_TAG_LENGTH } from '#shared/utils/tags'

export const LAST_SCREEN_KEY = 'memo-last-screen-v1'

/** 복원은 세션이 유지되는 재기동에만 한다. 다른 로그인/향후 다른 인증 방식은 fail closed. */
export function screenScope(session: unknown): string | null {
  if (!session || typeof session !== 'object') return null
  const { id, user, loggedInAt } = session as Record<string, unknown>
  if (!user || typeof user !== 'object' || (user as Record<string, unknown>).owner !== true) return null
  if (typeof loggedInAt !== 'number' || !Number.isSafeInteger(loggedInAt) || loggedInAt <= 0) return null
  if (typeof id !== 'string' || !id || id.length > 256) return null
  return `owner:${id}:${loggedInAt}`
}

/** 주소 전체를 저장하지 않는다 — 네 화면의 공개된 선택 상태만 허용한다. */
export function screenPath(raw: string): string | null {
  if (raw.length > 4096 || !raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f]/.test(raw)) return null
  let url: URL
  try { url = new URL(raw, 'https://memo.invalid') } catch { return null }
  const path = url.pathname
  if (path === '/' || path === '/todo' || path === '/todo/done') return path
  if (path.startsWith('/m/')) {
    try {
      const id = decodeURIComponent(path.slice(3))
      if (!id || /[\u0000-\u001f]/.test(id) || path.slice(3).includes('/')) return null
      return `/m/${encodeURIComponent(id)}`
    } catch { return null }
  }
  if (path === '/tags') {
    const rawTag = url.searchParams.get('tag')
    if (rawTag === null) return '/tags'
    const tag = cleanTag(rawTag)
    if (!tag || tag.length > MAX_TAG_LENGTH) return null
    return `/tags?${new URLSearchParams({ tag })}`
  }
  if (path === '/calendar') {
    const query = new URLSearchParams()
    const month = url.searchParams.get('m')
    const day = url.searchParams.get('d')
    if (month !== null) {
      if (!/^\d{4}-\d{2}$/.test(month) || !isDateString(`${month}-01`)) return null
      query.set('m', month)
    }
    if (day !== null) {
      if (!isDateString(day)) return null
      query.set('d', day)
    }
    return `/calendar${query.size ? `?${query}` : ''}`
  }
  return null
}

export function readScreen(raw: string | null, scope: string): string | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    if (!value || typeof value !== 'object') return null
    const state = value as Record<string, unknown>
    if (state.version !== 1 || state.scope !== scope || typeof state.path !== 'string') return null
    const path = screenPath(state.path)
    return path === state.path ? path : null
  } catch { return null }
}

export function needsScreenTree(path: string) {
  return path.startsWith('/m/') || path.startsWith('/tags?')
}

/** 휴지통·읽을 수 없는 메모와 사라진 태그는 복원하지 않는다. 본문은 보관하지 않는다. */
export function availableScreen(path: string, tree: Pick<TreeResponse, 'memos'>): boolean {
  if (path.startsWith('/m/')) return tree.memos.some((memo) => memo.id === decodeURIComponent(path.slice(3)) && !memo.unreadable)
  const tag = new URL(path, 'https://memo.invalid').searchParams.get('tag')
  return !tag || tree.memos.some((memo) => !memo.unreadable && hasTag(memo.tags, tag))
}

export function shouldRestoreScreen(initial: string, to: string, attempted: boolean) {
  return !attempted && initial === '/' && to === '/'
}
