/**
 * 구글 캘린더 API — 서비스 계정 하나로 전용 「메모」 캘린더 하나만 다룬다 (설계문서 §8.1).
 *
 * 구글 SDK 를 쓰지 않는다. 필요한 것은 토큰 교환(JWT 서명) 한 번과 일정 목록·생성·수정·삭제 네 가지뿐이라
 * node:crypto 와 fetch 로 충분하다 (스파이크 S5 에서 같은 방식으로 실측).
 */
import { createSign } from 'node:crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const API = 'https://www.googleapis.com/calendar/v3/calendars'
/** 토큰 유효시간은 1시간. 만료 1분 전부터 새로 받는다 */
const TOKEN_MARGIN_MS = 60_000
const TIMEOUT_MS = 15_000
const PAGE_SIZE = 2500
/** 대조에 쓰는 필드만 받는다 */
const LIST_FIELDS = 'items(id,summary,description,start,end,extendedProperties),nextPageToken'

export interface ServiceAccountKey {
  client_email: string
  private_key: string
}

export interface GoogleEventTime {
  date?: string | null
  dateTime?: string | null
  timeZone?: string | null
}

export interface GoogleEvent {
  id: string
  summary?: string
  description?: string
  start?: GoogleEventTime
  end?: GoogleEventTime
  extendedProperties?: { private?: Record<string, string> }
}

export interface EventWrite extends Omit<GoogleEvent, 'id'> {
  transparency?: 'opaque' | 'transparent'
}

export interface CalendarApi {
  /** 캘린더의 일정 전체 (취소된 것 제외) */
  list(): Promise<GoogleEvent[]>
  insert(body: EventWrite): Promise<GoogleEvent>
  patch(eventId: string, body: EventWrite): Promise<GoogleEvent>
  /** 이미 지워진 일정(404·410)은 성공으로 본다 */
  remove(eventId: string): Promise<void>
}

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** 키 JSON 문자열 → 키. 화면·로그에 키 내용을 싣지 않는다 */
export function parseServiceAccount(json: string): ServiceAccountKey {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('서비스 계정 키가 JSON 이 아닙니다')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('client_email' in parsed) ||
    !('private_key' in parsed) ||
    typeof parsed.client_email !== 'string' ||
    typeof parsed.private_key !== 'string'
  ) {
    throw new Error('서비스 계정 키에 client_email·private_key 가 없습니다')
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

interface Options {
  key: ServiceAccountKey
  calendarId: string
  fetch?: typeof fetch
  now?: () => number
}

export function createGoogleCalendar({ key, calendarId, fetch: doFetch = fetch, now = Date.now }: Options): CalendarApi {
  const base = `${API}/${encodeURIComponent(calendarId)}/events`
  let token: { value: string; expiresAt: number } | null = null

  async function accessToken() {
    if (token && token.expiresAt - TOKEN_MARGIN_MS > now()) return token.value
    const iat = Math.floor(now() / 1000)
    const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 })}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')
    const res = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const json = await readJson(res)
    if (!res.ok || !isToken(json)) throw new GoogleApiError(res.status, `구글 인증 실패 (${res.status}): ${errorText(json)}`)
    token = { value: json.access_token, expiresAt: now() + json.expires_in * 1000 }
    return token.value
  }

  async function call(method: string, path: string, body?: EventWrite) {
    const res = await doFetch(base + path, {
      method,
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const json = await readJson(res)
    // 토큰이 서버 쪽에서 먼저 무효가 됐다 — 다음 호출이 새로 받게 한다
    if (res.status === 401) token = null
    return { res, json }
  }

  function fail(res: Response, json: unknown, what: string): never {
    throw new GoogleApiError(res.status, `구글 캘린더 ${what} 실패 (${res.status}): ${errorText(json)}`)
  }

  return {
    async list() {
      const events: GoogleEvent[] = []
      let pageToken = ''
      do {
        const query = new URLSearchParams({ maxResults: String(PAGE_SIZE), fields: LIST_FIELDS })
        if (pageToken) query.set('pageToken', pageToken)
        const { res, json } = await call('GET', `?${query}`)
        if (!res.ok || !isEventPage(json)) fail(res, json, '목록 받기')
        events.push(...(json.items ?? []).filter(isEvent))
        pageToken = json.nextPageToken ?? ''
      } while (pageToken)
      return events
    },

    async insert(body) {
      const { res, json } = await call('POST', '', body)
      if (!res.ok || !isEvent(json)) fail(res, json, '일정 만들기')
      return json
    },

    async patch(eventId, body) {
      const { res, json } = await call('PATCH', `/${encodeURIComponent(eventId)}`, body)
      if (!res.ok || !isEvent(json)) fail(res, json, '일정 고치기')
      return json
    },

    async remove(eventId) {
      const { res, json } = await call('DELETE', `/${encodeURIComponent(eventId)}`)
      if (!res.ok && res.status !== 404 && res.status !== 410) fail(res, json, '일정 지우기')
    },
  }
}

function b64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

/** 구글 응답 본문. 밖에서 온 모양이라 unknown 으로 받고 아래 가드로 좁힌다 */
async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isToken(value: unknown): value is { access_token: string; expires_in: number } {
  return isRecord(value) && typeof value.access_token === 'string' && typeof value.expires_in === 'number'
}

function isEvent(value: unknown): value is GoogleEvent {
  return isRecord(value) && typeof value.id === 'string'
}

function isEventPage(value: unknown): value is { items?: unknown[]; nextPageToken?: string } {
  return (
    isRecord(value) &&
    (value.items === undefined || Array.isArray(value.items)) &&
    (value.nextPageToken === undefined || typeof value.nextPageToken === 'string')
  )
}

/** `{ error: { message } }`(API) 또는 `{ error, error_description }`(토큰) */
function errorText(json: unknown) {
  if (isRecord(json)) {
    const { error } = json
    if (isRecord(error) && typeof error.message === 'string') return error.message
    if (typeof json.error_description === 'string') return json.error_description
    if (typeof error === 'string') return error
  }
  return typeof json === 'string' ? json.slice(0, 200) : '응답 없음'
}
