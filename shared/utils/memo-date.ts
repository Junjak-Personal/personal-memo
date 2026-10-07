/**
 * 날짜 규칙. 이 앱은 한국에서 한 사람이 쓴다 — 시각은 KST(+09:00, 서머타임 없음)로 고정한다.
 * 컨테이너의 TZ 가 UTC 여도 결과가 같아야 하므로 시스템 시간대에 기대지 않는다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** `2026-10-06T21:03:00+09:00` */
export function nowKst(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19) + '+09:00'
}

/** 시각 문자열 → 그 시각의 KST 날짜(`YYYY-MM-DD`). 읽을 수 없으면 null */
export function kstDay(iso: string) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` 이고 실제로 있는 날인가 (2026-02-30 거부) */
export function isDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** `YYYY-MM-DD` 에 n 일을 더한다. 시간대와 무관하게 날짜만 계산한다 */
export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` 의 요일. 0 = 일요일 */
export function weekdayOf(day: string) {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}

/** 오늘(KST) `YYYY-MM-DD` */
export function todayKst() {
  return nowKst().slice(0, 10)
}
