// 스모크가 캘린더를 직접 보고 고칠 때 쓰는 최소 클라이언트. 키·토큰은 출력하지 않는다.
// 앱 쪽 구현은 server/calendar/google.ts — 이건 그것과 독립적으로 결과를 확인하려는 것이다.
import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export async function connect(keyPath, calendarId) {
  const key = JSON.parse(await readFile(keyPath, 'utf8'))
  const b64url = (v) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 1800,
  })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const { access_token: token } = await res.json()
  if (!token) throw new Error(`토큰 교환 실패 ${res.status}`)
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`

  async function api(method, path = '', body) {
    const r = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await r.text()
    const json = text ? JSON.parse(text) : null
    if (!r.ok && !(method === 'DELETE' && (r.status === 404 || r.status === 410))) {
      throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json?.error?.message)}`)
    }
    return json
  }

  async function list() {
    const items = []
    let pageToken = ''
    do {
      const q = new URLSearchParams({ maxResults: '2500' })
      if (pageToken) q.set('pageToken', pageToken)
      const page = await api('GET', `?${q}`)
      items.push(...(page.items ?? []))
      pageToken = page.nextPageToken ?? ''
    } while (pageToken)
    return items
  }

  return { api, list }
}

export const memoIdOf = (event) => event.extendedProperties?.private?.memoId
