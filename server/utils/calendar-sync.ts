/**
 * 구글 캘린더 동기화 하나를 프로세스 전체가 같이 쓴다 (설계문서 §8.3).
 *
 * 설정(캘린더 ID + 서비스 계정 키)이 없으면 끈다. 개발 기본값이 «꺼짐»인 이유 — 로컬 샘플 메모가 실제
 * 「메모」 캘린더에 섞이고, 같은 캘린더를 운영과 나눠 쓰면 서로의 일정을 «주인 없는 일정»으로 보고 지운다.
 */
import { readFileSync } from 'node:fs'
import type { CalendarSyncStatus } from '../../shared/types/calendar-sync'
import { createGoogleCalendar, parseServiceAccount } from '../calendar/google'
import { CalendarSync } from '../calendar/sync'

let created = false
let sync: CalendarSync | null = null
let unavailable: CalendarSyncStatus = { state: 'off', message: '' }

function log(message: string) {
  console.info(`[calendar-sync] ${message}`)
}

function create() {
  const { google, siteUrl } = useRuntimeConfig()
  if (!google.calendarId || (!google.serviceAccount && !google.serviceAccountFile)) {
    unavailable = { state: 'off', message: '구글 캘린더 연동이 꺼져 있습니다 (캘린더 ID·서비스 계정 키 설정 없음)' }
    return
  }
  let json: string
  try {
    json = google.serviceAccount ? Buffer.from(google.serviceAccount, 'base64').toString('utf8') : readFileSync(google.serviceAccountFile, 'utf8')
  } catch {
    unavailable = { state: 'broken', message: '서비스 계정 키 파일을 읽지 못했습니다' }
    log(unavailable.message)
    return
  }
  try {
    const key = parseServiceAccount(json)
    sync = new CalendarSync({
      api: createGoogleCalendar({ key, calendarId: google.calendarId }),
      snapshot: async () => (await useMemoStore()).calendarSnapshot(),
      siteUrl,
      log,
    })
  } catch (e) {
    unavailable = { state: 'broken', message: e instanceof Error ? e.message : '서비스 계정 키를 읽지 못했습니다' }
    log(unavailable.message)
  }
}

/** 꺼져 있으면 null — 저장 경로는 `useCalendarSync()?.notify(memo)` 처럼 부른다 */
export function useCalendarSync() {
  if (!created) {
    created = true
    create()
  }
  return sync
}

export function calendarSyncStatus(): CalendarSyncStatus {
  return useCalendarSync()?.status() ?? unavailable
}
