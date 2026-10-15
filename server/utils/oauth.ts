/**
 * OAuth·MCP 공용 (설계: _docs/active/planning/2026-10-16-mcp-connector.md).
 * 이 앱이 MCP 서버이면서 자기 인증 서버다 — 발급자(issuer)는 앱 주소, 보호 자원(resource)은 `<앱 주소>/mcp`.
 */
import { join, resolve } from 'node:path'
import type { H3Event } from 'h3'
import { OAuthGrants } from '../oauth/grants'

export const MCP_SCOPE = 'memo'

let grants: OAuthGrants | null = null
let ready: Promise<void> | null = null

export async function useOAuthGrants() {
  if (!grants) {
    const { dataDir } = useRuntimeConfig()
    grants = new OAuthGrants(resolve(join(dataDir, 'oauth')))
    ready = grants.init()
  }
  await ready
  return grants
}

/**
 * 앱 주소. 운영은 NUXT_SITE_URL(https://memo.jun-devlog.win) — 터널 뒤라 요청 주소는 http://localhost 로 보인다.
 * 개발처럼 비어 있으면 요청에서 짐작한다.
 */
export function oauthUrls(event: H3Event) {
  const { siteUrl } = useRuntimeConfig()
  const issuer = (siteUrl || getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin).replace(/\/+$/, '')
  return {
    issuer,
    resource: `${issuer}/mcp`,
    resourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
  }
}

/** 허용한 클라이언트 신원 문서의 출처 — 기본 claude.ai (웹·폰·Desktop·Claude Code)·chatgpt.com */
export function clientOrigins() {
  // runtimeConfig.oauth 는 nuxt-auth-utils 가 쓰는 자리라 mcp 아래에 둔다
  const { mcp } = useRuntimeConfig()
  return String(mcp.clientOrigins)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

/**
 * 클라이언트가 보낸 resource 가 이 서버인가 — MCP 주소(`…/mcp`) 또는 서버 주소 자체.
 * OpenAI 문서는 ChatGPT 가 `resource=https://your-mcp.example.com` 처럼 서버 주소만 보낸다고 적는다. 어느 쪽이든 발급하는 토큰의
 * 받을 곳(aud)은 언제나 MCP 주소 하나다.
 */
export function isOurResource(requested: string, urls: { issuer: string; resource: string }) {
  return sameResource(requested, urls.resource) || sameResource(requested, urls.issuer)
}

/**
 * 토큰 요청의 클라이언트 id. 보통은 client_id 로 오지만, ChatGPT 처럼 서명 단언(private_key_jwt)을 기본으로 쓰는 클라이언트는
 * client_assertion 만 보낼 수 있다 — 그때는 단언의 sub(= client_id)를 읽는다. 서명은 확인하지 않는다: 이 서버는 공개 클라이언트만
 * 받고, 코드를 내주는 일은 승인 때의 client_id·돌아갈 주소·PKCE 가 다 맞아야 하므로 id 를 바꿔 쳐도 얻는 것이 없다.
 */
export function tokenClientId(body: { client_id?: string; client_assertion?: string }) {
  if (body.client_id) return body.client_id
  const payload = body.client_assertion?.split('.')[1]
  if (!payload) return ''
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const sub = typeof claims === 'object' && claims !== null ? (claims as Record<string, unknown>).sub : undefined
    return typeof sub === 'string' ? sub : ''
  } catch {
    return ''
  }
}

/** resource 값 비교 — 끝의 빗금과 스킴·호스트의 대소문자는 가리지 않는다 */
export function sameResource(a: string, b: string) {
  const norm = (value: string) => {
    try {
      const url = new URL(value)
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
    } catch {
      return value
    }
  }
  return norm(a) === norm(b)
}
