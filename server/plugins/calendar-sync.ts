/**
 * 구글 캘린더 대조 시점 — 서버 시작 + 5분마다 (설계문서 §8.3). 앱에서 저장한 직후는 각 API 가 부른다.
 */
const START_DELAY_MS = 3000
const INTERVAL_MS = 5 * 60 * 1000

export default defineNitroPlugin((nitroApp) => {
  const sync = useCalendarSync()
  if (!sync) {
    console.info(`[calendar-sync] ${calendarSyncStatus().state === 'off' ? '꺼짐 (설정 없음)' : '설정 오류로 꺼짐'}`)
    return
  }
  const first = setTimeout(() => void sync.run(), START_DELAY_MS)
  const timer = setInterval(() => void sync.run(), INTERVAL_MS)
  nitroApp.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
    sync.stop()
  })
})
