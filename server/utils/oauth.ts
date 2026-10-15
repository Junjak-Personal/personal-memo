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

/** 허용한 클라이언트 신원 문서의 출처 — 기본 claude.ai (웹·폰·Desktop·Claude Code) */
export function clientOrigins() {
  // runtimeConfig.oauth 는 nuxt-auth-utils 가 쓰는 자리라 mcp 아래에 둔다
  const { mcp } = useRuntimeConfig()
  return String(mcp.clientOrigins)
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
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
