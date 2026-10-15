/**
 * OAuth 찾기 문서 (설계: _docs/active/planning/2026-10-16-mcp-connector.md).
 * `.well-known` 은 점으로 시작해 server/routes 가 줍지 않는다 — 그래서 미들웨어에서 답한다(SPA 가 HTML 로 답하기 전에).
 *
 * - 보호 자원 메타데이터 (RFC 9728): MCP 주소와 인증 서버. claude.ai 는 401 의 resource_metadata 를 보고 이걸 읽는다
 * - 인증 서버 메타데이터 (RFC 8414): CIMD 를 광고해 Claude 가 등록 없이 자기 신원 문서로 붙게 한다 —
 *   client_id_metadata_document_supported + token_endpoint_auth_methods_supported: ["none"] 이 둘 다 있어야 Claude 가 CIMD 를 고른다
 */
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/.well-known/oauth-')) return
  const { issuer, resource } = oauthUrls(event)
  setResponseHeader(event, 'cache-control', 'public, max-age=300')

  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
    return {
      resource,
      authorization_servers: [issuer],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'memo',
    }
  }
  if (path === '/.well-known/oauth-authorization-server') {
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      scopes_supported: [MCP_SCOPE],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    }
  }
  throw createError({ statusCode: 404 })
})
