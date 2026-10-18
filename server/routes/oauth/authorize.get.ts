/**
 * 승인 요청 (OAuth 2.1 인가 끝점). 확인을 마치면 승인 화면(/oauth/consent)으로 보낸다 — 앱에 로그인하지 않았으면 그 화면이
 * 로그인부터 받는다. 실제 허용은 로그인한 사람만 부를 수 있는 /api/oauth/requests/:id 가 한다.
 *
 * 🔴 클라이언트와 돌아갈 주소를 확인하기 전에는 그 주소로 보내지 않는다 — 오류도 화면에 직접 쓴다 (열린 리다이렉트 방지).
 */
import { loadClient, redirectAllowed } from '../../oauth/client'

function errorPage(message: string) {
  const safe = message.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>memo — 연결할 수 없습니다</title><body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto"><h1 style="font-size:1.1rem">AI 연결을 시작할 수 없습니다</h1><p>${safe}</p></body>`
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const str = (key: string) => (typeof query[key] === 'string' ? (query[key] as string) : '')
  const clientId = str('client_id')
  const redirectUri = str('redirect_uri')

  const who = `${logValue(clientId)} → ${logValue(redirectUri)}`
  let client
  try {
    client = await loadClient(clientId, { origins: clientOrigins() })
  } catch (error) {
    const message = error instanceof Error ? error.message : '클라이언트를 확인하지 못했습니다'
    oauthLog(event, `승인 요청 거절 ${who}: ${message}`)
    setResponseStatus(event, 400)
    return errorPage(message)
  }
  if (!redirectAllowed(redirectUri, client.redirectUris)) {
    oauthLog(event, `승인 요청 거절 ${who}: 돌아갈 주소가 신원 문서에 없음 (문서: ${logValue(client.redirectUris.join(' '), 300)})`)
    setResponseStatus(event, 400)
    return errorPage('돌아갈 주소(redirect_uri)가 클라이언트 신원 문서에 없습니다')
  }

  const { issuer, resource } = oauthUrls(event)
  const state = str('state') || null
  const fail = (error: string, description: string) => {
    oauthLog(event, `승인 요청 거절 ${who}: ${error} ${description}`)
    const url = new URL(redirectUri)
    url.searchParams.set('error', error)
    url.searchParams.set('error_description', description)
    if (state) url.searchParams.set('state', state)
    url.searchParams.set('iss', issuer)
    return sendRedirect(event, url.toString(), 302)
  }

  if (str('response_type') !== 'code') return fail('unsupported_response_type', 'response_type 은 code 만 받습니다')
  const challenge = str('code_challenge')
  if (str('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return fail('invalid_request', 'PKCE(S256) code_challenge 가 필요합니다')
  }
  // 규격상 클라이언트는 resource 를 보내야 한다. 안 보냈으면 이 서버의 MCP 주소로 본다
  const requested = str('resource') || resource
  if (!isOurResource(requested, { issuer, resource })) return fail('invalid_target', `이 서버의 자원은 ${resource} 하나입니다`)

  const grants = await useOAuthGrants()
  const id = grants.createRequest({
    clientId: client.clientId,
    clientHost: client.host,
    redirectUri,
    state,
    codeChallenge: challenge,
    // 범위는 하나(memo) — 무엇을 청하든 이것만 준다
    scope: MCP_SCOPE,
    resource,
  })
  oauthLog(event, `승인 요청 ${who} resource=${logValue(str('resource'))} → 승인 화면`)
  return sendRedirect(event, `/oauth/consent?request=${encodeURIComponent(id)}`, 302)
})
