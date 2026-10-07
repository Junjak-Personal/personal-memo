/**
 * 휴지통 보관 기간 (설계문서 §3.4). 서버의 자동 정리와 휴지통 화면이 같은 값을 쓴다.
 * 들어간 시각은 파일 mtime 이다 — 앱이 휴지통에 넣을 때 mtime 을 그 시각으로 바꾼다.
 */
export const TRASH_RETENTION_DAYS = 30

export const DAY_MS = 24 * 60 * 60 * 1000

/** 자동으로 지워지기까지 남은 날 (올림). 0 이면 다음 정리 때 지워진다 */
export function daysUntilPurge(trashedAt: string, now = Date.now()) {
  const t = Date.parse(trashedAt)
  if (Number.isNaN(t)) return TRASH_RETENTION_DAYS
  return Math.max(0, Math.ceil((t + TRASH_RETENTION_DAYS * DAY_MS - now) / DAY_MS))
}
