/**
 * OAuth 클라이언트 확인 — Client ID Metadata Document (MCP 인증 규격 2026-07-28 이 권하는 방식, 설계: _docs/…/mcp-connector).
 *
 * 클라이언트 id 가 곧 신원 문서의 HTTPS 주소다. 미리 등록해 두지 않고, 승인 요청이 올 때 그 문서를 읽어 돌아갈 주소를 맞춘다.
 * 🔴 아무 주소나 읽지 않는다 — 허용한 출처(기본 `https://claude.ai`, `https://chatgpt.com`)의 문서만. 그래서 claude.ai(웹·폰·
 *    Desktop)·Claude Code·ChatGPT 만 승인 화면까지 올 수 있고, 서버가 임의 주소를 읽는 일(SSRF)도 없다.
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export interface OAuthClient {
  /** 신원 문서 주소 = client_id */
  clientId: string
  /** 승인 화면에 보여 줄 이름 — 문서가 스스로 말하는 client_name 이 아니라 client_id 주소의 호스트 */
  host: string
  redirectUris: string[]
}

export class OAuthClientError extends Error {}

/** client_id 가 허용한 출처의 주소인가. 출처는 `https://claude.ai` 처럼 스킴·호스트·포트까지 */
export function isAllowedClientId(clientId: string, origins: readonly string[]) {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return false
  }
  return origins.includes(url.origin) && url.pathname !== '/' && !url.hash && !url.username && !url.password
}

const MAX_DOCUMENT_BYTES = 64 * 1024
const FETCH_TIMEOUT_MS = 5000
const CACHE_MS = 10 * 60 * 1000

interface Cached {
  client: OAuthClient
  at: number
}

const cache = new Map<string, Cached>()

/** 신원 문서를 읽고 확인한다. 문서의 client_id 가 주소와 같아야 하고, 돌아갈 주소 목록이 있어야 한다 */
export async function loadClient(
  clientId: string,
  options: { origins: readonly string[]; fetch?: typeof fetch; now?: () => number },
): Promise<OAuthClient> {
  if (!isAllowedClientId(clientId, options.origins)) throw new OAuthClientError('허용하지 않은 클라이언트입니다')
  const now = options.now?.() ?? Date.now()
  const hit = cache.get(clientId)
  if (hit && now - hit.at < CACHE_MS) return hit.client

  const res = await (options.fetch ?? fetch)(clientId, {
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch(() => null)
  if (!res?.ok) throw new OAuthClientError('클라이언트 신원 문서를 읽지 못했습니다')
  const text = await readCapped(res, MAX_DOCUMENT_BYTES)

  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new OAuthClientError('클라이언트 신원 문서가 JSON 이 아닙니다')
  }
  if (typeof doc !== 'object' || doc === null) throw new OAuthClientError('클라이언트 신원 문서 모양이 다릅니다')
  const fields = doc as Record<string, unknown>
  if (fields.client_id !== clientId) throw new OAuthClientError('신원 문서의 client_id 가 주소와 다릅니다')
  const redirectUris = fields.redirect_uris
  if (!Array.isArray(redirectUris) || !redirectUris.length || !redirectUris.every((u) => typeof u === 'string')) {
    throw new OAuthClientError('신원 문서에 돌아갈 주소(redirect_uris)가 없습니다')
  }
  /*
   * 공개 클라이언트(비밀 없이 PKCE 만)로 붙을 수 있어야 한다 — 이 서버는 클라이언트 비밀·서명 단언을 받지 않는다.
   * ChatGPT 문서는 기본값이 private_key_jwt 이지만 token_endpoint_auth_methods_supported 에 none 이 있어, 이 서버가 광고하는
   * none 으로 붙는다 (2026-10-16 chatgpt.com/oauth/client.json 실측).
   */
  const method = fields.token_endpoint_auth_method
  const supported = Array.isArray(fields.token_endpoint_auth_methods_supported) ? fields.token_endpoint_auth_methods_supported : []
  if (method !== undefined && method !== 'none' && !supported.includes('none')) {
    throw new OAuthClientError('공개 클라이언트(token_endpoint_auth_method: none)만 받습니다')
  }
  /*
   * 돌아갈 주소는 신원 문서와 같은 출처이거나 루프백만 받는다 (2026-10-16 보안 검토, Claude 문서 권고).
   * 출처 단위로 허용하므로 그 출처 어딘가가 남의 JSON 을 내준다면, 이 규칙이 없을 때 승인 코드가 바깥 사이트로 갈 수 있다.
   */
  const origin = new URL(clientId).origin
  const safe = redirectUris.filter((uri) => isLoopback(uri) || sameOrigin(uri, origin))
  if (!safe.length) throw new OAuthClientError('돌아갈 주소가 클라이언트와 같은 출처가 아닙니다')
  const client = { clientId, host: new URL(clientId).host, redirectUris: safe }
  cache.set(clientId, { client, at: now })
  return client
}

/**
 * 본문을 상한까지만 읽는다 — 다 읽은 뒤 크기를 보면 상한이 막지 못한다 (2026-10-16 보안 검토).
 * Content-Length 가 이미 크면 읽지 않고, 읽는 도중 넘으면 그 자리에서 끊는다.
 */
async function readCapped(res: Response, max: number) {
  const tooBig = () => new OAuthClientError('클라이언트 신원 문서가 너무 큽니다')
  if (Number(res.headers.get('content-length') ?? 0) > max) {
    await res.body?.cancel()
    throw tooBig()
  }
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function sameOrigin(uri: string, origin: string) {
  try {
    return new URL(uri).origin === origin
  } catch {
    return false
  }
}

/** 루프백 주소인가 — Claude Code 같은 데스크톱 앱이 이 컴퓨터의 임시 포트로 받는다 */
export function isLoopback(uri: string) {
  try {
    const url = new URL(uri)
    return url.protocol === 'http:' && LOOPBACK.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * 요청한 돌아갈 주소가 문서의 목록에 있는가. 정확히 같아야 한다 — 루프백만 포트를 보지 않는다
 * (RFC 8252 §7.3, Claude Code 는 실행마다 다른 포트를 쓴다).
 */
export function redirectAllowed(requested: string, registered: readonly string[]) {
  if (registered.includes(requested)) return true
  if (!isLoopback(requested)) return false
  const want = new URL(requested)
  return registered.some((uri) => {
    if (!isLoopback(uri)) return false
    const have = new URL(uri)
    return have.hostname === want.hostname && have.pathname === want.pathname && have.search === want.search
  })
}

/** PKCE S256 — code_verifier 의 SHA-256 이 code_challenge 와 같은가 */
export function verifyPkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'))
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 테스트에서 캐시를 비운다 */
export function clearClientCache() {
  cache.clear()
}
