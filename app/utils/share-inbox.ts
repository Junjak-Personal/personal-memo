/**
 * 공유 시트로 받은 글 → 새 메모 (설계문서 §10.4). 순수 함수 — 플러그인(plugins/memo-inbox.client.ts)이 쓴다.
 */
import type { CreateMemoInput } from '#shared/types/memo'

/** 공유로 받은 메모가 들어가는 폴더 */
export const INBOX_FOLDER = '받은 메모'

const MAX_TITLE = 80

/** 네이티브 보관함의 한 줄 (ios/Shared/MemoInbox.swift 의 MemoInboxItem) */
export interface InboxItem {
  id: string
  text: string
  url: string | null
  receivedAt: string
}

/** 네이티브에서 온 값 — 모양을 믿지 않고 좁힌다 */
export function isInboxItem(value: unknown): value is InboxItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.text === 'string' &&
    (v.url === null || v.url === undefined || typeof v.url === 'string') &&
    typeof v.receivedAt === 'string'
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/** 마크다운 링크 글자 안의 대괄호·역슬래시 */
function escapeLinkText(text: string) {
  return text.replace(/([[\]\\])/g, '\\$1')
}

/** 링크 주소 안의 괄호·공백 — 그대로 두면 `](…)` 가 일찍 끝난다 */
function escapeUrl(url: string) {
  return url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20')
}

/**
 * 제목 = 글의 첫 줄(사파리 공유면 페이지 제목) → 없으면 링크의 호스트 → 「공유한 메모」.
 * 본문 = 링크(`[제목](주소)` — 에디터가 그대로 다시 쓰는 꼴이라 열어도 형식 경고가 안 뜬다) + 첫 줄 뒤의 나머지 글.
 */
export function memoFromShare(item: InboxItem): Omit<CreateMemoInput, 'folder'> {
  const lines = item.text.trim().split(/\r?\n/)
  const first = (lines[0] ?? '').trim()
  const rest = lines.slice(1).join('\n').trim()
  const raw = item.url?.trim() || null
  // 링크로 만드는 것은 http(s) 뿐 — 다른 스킴(javascript: 등)은 글자로만 남긴다
  const url = raw && /^https?:\/\//i.test(raw) ? raw : null
  const title = (first || (url && hostOf(url)) || '공유한 메모').slice(0, MAX_TITLE).trim()
  const link = url ? `[${escapeLinkText(first || url)}](${escapeUrl(url)})` : raw && raw !== first ? raw : ''
  const content = [link, rest].filter(Boolean).join('\n\n')
  return { title, content, date: null, dateEnd: null, tags: [] }
}
