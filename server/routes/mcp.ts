/**
 * MCP 끝점 (Streamable HTTP, 세션 없음, JSON 응답) — 설계: _docs/active/planning/2026-10-16-mcp-connector.md.
 *
 * 토큰이 없거나 틀리면 SDK 에 넘기기 전에 401 + `WWW-Authenticate: Bearer resource_metadata=…` — claude.ai 는 이 응답을 보고
 * 로그인을 시작한다(200 안의 오류로는 시작하지 않는다). 요청마다 서버를 새로 만든다 — 상태는 MemoStore 에만 있다.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { buildMcpServer } from '../mcp/tools'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    // 서버가 먼저 보내는 알림(SSE)이나 세션이 없다
    setResponseHeader(event, 'allow', 'POST')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const { resource, resourceMetadata } = oauthUrls(event)
  const header = getRequestHeader(event, 'authorization') ?? ''
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? ''
  const claims = token ? (await useOAuthGrants()).verifyAccess(token, resource) : null
  if (!claims) {
    // 🔴 헤더 값은 ASCII 만 — 한국어를 넣었더니 Node 가 헤더를 거부해 401 대신 500 이 났다(만료·끊긴 토큰, 2026-10-16 e2e).
    //    그러면 Claude 가 갱신·재로그인을 시작하지 못한다. 한국어 설명은 본문에만 둔다
    const error = token ? 'error="invalid_token", error_description="The access token is expired or revoked", ' : ''
    setResponseHeader(event, 'www-authenticate', `Bearer ${error}resource_metadata="${resourceMetadata}", scope="${MCP_SCOPE}"`)
    setResponseStatus(event, 401)
    return { error: 'invalid_token', error_description: token ? '토큰이 만료됐거나 연결이 끊겼습니다' : '로그인이 필요합니다' }
  }
  if (!claims.scope.split(' ').includes(MCP_SCOPE)) {
    setResponseHeader(event, 'www-authenticate', `Bearer error="insufficient_scope", scope="${MCP_SCOPE}", resource_metadata="${resourceMetadata}"`)
    setResponseStatus(event, 403)
    return { error: 'insufficient_scope' }
  }

  const sync = useCalendarSync()
  const server = buildMcpServer({
    store: await useMemoStore(),
    notify: (memo) => sync?.notify(memo),
    notifyRemoved: (id) => sync?.notifyRemoved(id),
    log: (message) => console.info(message),
    client: new URL(claims.cid).host,
  })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  event.node.res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(event.node.req, event.node.res, await readBody(event))
})
