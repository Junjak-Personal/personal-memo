/**
 * 허용·거부 — `{ allow: boolean }` → 돌아갈 주소. 허용이면 승인 코드(1분, 한 번), 거부면 access_denied 를 실어 보낸다.
 * /api 아래라 앱 비밀번호로 로그인한 사람만 부를 수 있다. iss 를 같이 실어 클라이언트가 발급자를 확인하게 한다 (RFC 9207).
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body: unknown = await readBody(event)
  const allow = typeof body === 'object' && body !== null && (body as Record<string, unknown>).allow === true
  const grants = await useOAuthGrants()
  const { issuer } = oauthUrls(event)

  const approved = allow ? grants.approve(id) : null
  const request = approved?.request ?? (allow ? null : grants.deny(id))
  if (!request) throw createError({ statusCode: 404, data: { message: '승인 요청이 없거나 만료됐습니다. AI 앱에서 다시 연결하세요.' } })

  const url = new URL(request.redirectUri)
  if (approved) url.searchParams.set('code', approved.code)
  else url.searchParams.set('error', 'access_denied')
  if (request.state) url.searchParams.set('state', request.state)
  url.searchParams.set('iss', issuer)
  if (approved) console.info(`[mcp] 연결 허용 (${request.clientHost} → ${url.host})`)
  return { redirect: url.toString() }
})
