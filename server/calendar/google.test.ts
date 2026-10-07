import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createGoogleCalendar, GoogleApiError, parseServiceAccount } from './google'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = { client_email: 'memo@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

/** 구글 흉내. handler 가 [상태, 본문] 을 돌려준다 */
function fakeFetch(handler: (call: Call) => [number, object | null]) {
  const calls: Call[] = []
  const fn: typeof fetch = async (input, init) => {
    const call = {
      method: init?.method ?? 'GET',
      url: String(input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === 'string' ? init.body : (init?.body?.toString() ?? ''),
    }
    calls.push(call)
    const [status, body] = handler(call)
    return new Response(body === null ? null : JSON.stringify(body), { status })
  }
  return { fn, calls }
}

const TOKEN = [200, { access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' }] as [number, object]

describe('createGoogleCalendar', () => {
  it('서비스 계정 JWT 를 RS256 으로 서명해 토큰을 받고, 만료 전까지 다시 쓴다', async () => {
    let clock = 1_800_000_000_000
    const { fn, calls } = fakeFetch((c) => (c.url.includes('oauth2') ? TOKEN : [200, { items: [] }]))
    const api = createGoogleCalendar({ key, calendarId: 'cal@group.calendar.google.com', fetch: fn, now: () => clock })

    await api.list()
    await api.list()
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1)

    const assertion = new URLSearchParams(calls[0]!.body).get('assertion')!
    const [header, payload, signature] = assertion.split('.')
    const verified = createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature!, 'base64url')
    expect(verified).toBe(true)
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
    })
    expect(calls[1]!.headers.authorization).toBe('Bearer tok-1')
    expect(calls[1]!.url).toContain('/calendars/cal%40group.calendar.google.com/events?')

    // 만료 1분 전이면 새로 받는다
    clock += 3600_000 - 30_000
    await api.list()
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2)
  })

  it('목록은 nextPageToken 을 따라 끝까지 받는다', async () => {
    const { fn, calls } = fakeFetch((c) => {
      if (c.url.includes('oauth2')) return TOKEN
      return c.url.includes('pageToken=p2') ? [200, { items: [{ id: 'b' }] }] : [200, { items: [{ id: 'a' }, { nope: 1 }], nextPageToken: 'p2' }]
    })
    const events = await createGoogleCalendar({ key, calendarId: 'c', fetch: fn }).list()
    expect(events.map((e) => e.id)).toEqual(['a', 'b'])
    expect(calls.at(-1)!.url).toContain('maxResults=2500')
  })

  it('이미 지워진 일정(410)을 지우는 것은 성공으로 본다', async () => {
    const { fn } = fakeFetch((c) => (c.url.includes('oauth2') ? TOKEN : [410, { error: { message: 'Resource has been deleted' } }]))
    await expect(createGoogleCalendar({ key, calendarId: 'c', fetch: fn }).remove('gone')).resolves.toBeUndefined()
  })

  it('실패는 상태와 구글의 말을 담아 던진다', async () => {
    const { fn } = fakeFetch((c) => (c.url.includes('oauth2') ? TOKEN : [403, { error: { code: 403, message: 'Forbidden' } }]))
    const error = await createGoogleCalendar({ key, calendarId: 'c', fetch: fn })
      .insert({ summary: 'x' })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GoogleApiError)
    expect(error).toMatchObject({ status: 403, message: '구글 캘린더 일정 만들기 실패 (403): Forbidden' })
  })

  it('토큰 교환 실패도 같은 방식으로 알린다', async () => {
    const { fn } = fakeFetch(() => [400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }])
    await expect(createGoogleCalendar({ key, calendarId: 'c', fetch: fn }).list()).rejects.toThrow('구글 인증 실패 (400): Invalid JWT Signature.')
  })
})

describe('parseServiceAccount', () => {
  it('필요한 두 값만 꺼낸다', () => {
    expect(parseServiceAccount(JSON.stringify({ ...key, project_id: 'p' }))).toEqual(key)
  })

  it('모양이 틀리면 키 내용 없이 알린다', () => {
    expect(() => parseServiceAccount('{')).toThrow('JSON 이 아닙니다')
    expect(() => parseServiceAccount('{"client_email":"a"}')).toThrow('client_email·private_key')
  })
})
