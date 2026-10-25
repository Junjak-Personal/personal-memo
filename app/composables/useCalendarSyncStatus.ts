import type { CalendarSyncStatus } from '#shared/types/calendar-sync'

/** 저장 뒤 서버가 대조를 시작하기까지(2초) + 구글 왕복을 넉넉히 기다린 뒤 상태를 다시 본다 */
const RECHECK_MS = 6000

let recheckTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 구글 캘린더 동기화 상태 (설계문서 §8.3). 문서 화면의 「캘린더 반영 실패」와 캘린더 화면이 같이 쓴다.
 * 서버가 대조를 끝냈는지 알려 주지 않으므로, 제목·날짜를 저장한 뒤 잠시 기다렸다가 한 번 다시 본다 — watch 로 따라가지 않는다.
 */
export function useCalendarSyncStatus() {
  const status = useState<CalendarSyncStatus | null>('calendar-sync', () => null)
  const running = useState('calendar-sync-running', () => false)

  async function refresh() {
    try {
      status.value = await $fetch<CalendarSyncStatus>('/api/calendar/sync')
    } catch {
      // 상태를 못 받아도 메모 쓰기는 그대로 된다 — 표시만 비운다
      status.value = null
    }
  }

  /** 제목·날짜를 저장한 뒤 */
  function recheckSoon() {
    if (recheckTimer) clearTimeout(recheckTimer)
    recheckTimer = setTimeout(() => {
      recheckTimer = null
      void refresh()
    }, RECHECK_MS)
  }

  /** 지금 맞춘다. allowMassDelete 는 미뤄 둔 대량 삭제를 사람이 확인했을 때만 */
  async function runNow(allowMassDelete = false) {
    running.value = true
    try {
      status.value = await $fetch<CalendarSyncStatus>('/api/calendar/sync', { method: 'POST', body: { allowMassDelete } })
    } finally {
      running.value = false
    }
  }

  /** 메모별 실패(이전 일정 삭제 실패 포함)는 유지하고, 전역 오류는 현재 일정 대상에만 보인다. */
  function failureOf(memoId: string, scheduled: boolean) {
    const s = status.value
    if (s?.state !== 'on') return null
    return s.failures[memoId] ?? (scheduled && s.error ? s.error : null)
  }

  return { status, running, refresh, recheckSoon, runNow, failureOf }
}
