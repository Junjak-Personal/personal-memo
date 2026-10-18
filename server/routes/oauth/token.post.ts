/**
 * 토큰 끝점 — 승인 코드 교환(PKCE)과 갱신(회전). 본문은 application/x-www-form-urlencoded (RFC 6749 §4.1.3, Claude 도 이렇게 보낸다).
 * 공개 클라이언트만 받는다(비밀 없음). 실패는 RFC 6749 의 error 코드로 — 갱신 실패가 invalid_grant 여야 Claude 가 다시 로그인을 띄운다.
 */
import { OAuthGrantError } from '../../oauth/grants'

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'cache-control': 'no-store', pragma: 'no-cache' })
  const raw: unknown = await readBody(event).catch(() => null)
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const str = (key: string) => (typeof body[key] === 'string' ? (body[key] as string) : '')
  const grantType = str('grant_type')
  const fail = (status: number, error: string, description: string) => {
    oauthLog(event, `토큰 ${logValue(grantType, 40)} ${logValue(str('client_id') || (str('client_assertion') ? '(client_assertion)' : ''))} → ${error}: ${description}`)
    setResponseStatus(event, status)
    return { error, error_description: description }
  }

  const { issuer, resource } = oauthUrls(event)
  const requested = str('resource')
  if (requested && !isOurResource(requested, { issuer, resource })) return fail(400, 'invalid_target', `이 서버의 자원은 ${resource} 하나입니다`)
  const clientId = tokenClientId({ client_id: str('client_id'), client_assertion: str('client_assertion') })
  if (!clientId) return fail(400, 'invalid_request', 'client_id 가 필요합니다')

  const grants = await useOAuthGrants()
  try {
    switch (grantType) {
      case 'authorization_code': {
        const issued = await grants.exchangeCode({
          code: str('code'),
          clientId,
          redirectUri: str('redirect_uri'),
          codeVerifier: str('code_verifier'),
          resource: requested ? resource : null,
        })
        oauthLog(event, `토큰 authorization_code ${logValue(clientId)} → 발급`)
        return issued
      }
      case 'refresh_token':
        // 갱신은 자주 일어나 성공은 적지 않는다 — 실패만 (fail)
        return await grants.refresh({ refreshToken: str('refresh_token'), clientId, resource: requested ? resource : null })
      default:
        return fail(400, 'unsupported_grant_type', 'authorization_code 와 refresh_token 만 받습니다')
    }
  } catch (error) {
    if (error instanceof OAuthGrantError) return fail(400, error.code, error.message)
    throw error
  }
})
