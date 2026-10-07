/** `2026-10-10` → `10월 10일 (토)` — 날짜 고르기와 「할 일」 화면이 같이 쓴다 */
export function formatDay(day: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${day}T00:00:00`))
}
