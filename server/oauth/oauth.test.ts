import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearClientCache, isAllowedClientId, loadClient, redirectAllowed, verifyPkce } from './client'
import { ACCESS_TTL_S, OAuthGrants, REFRESH_TTL_MS } from './grants'

const ORIGINS = ['https://claude.ai']
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata'
const RESOURCE = 'https://memo.example.com/mcp'
// RFC 7636 부록 B
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
}

describe('클라이언트 확인 (Client ID Metadata Document)', () => {
  beforeEach(() => clearClientCache())

  it('허용한 출처의 HTTPS 문서만', () => {
    expect(isAllowedClientId(CLAUDE_CODE, ORIGINS)).toBe(true)
    expect(isAllowedClientId('https://evil.example/oauth/x', ORIGINS)).toBe(false)
    expect(isAllowedClientId('http://claude.ai/oauth/x', ORIGINS)).toBe(false)
    expect(isAllowedClientId('https://claude.ai/', ORIGINS)).toBe(false)
    expect(isAllowedClientId('not a url', ORIGINS)).toBe(false)
  })

  it('문서를 읽어 돌아갈 주소를 얻는다', async () => {
    const fetch = jsonFetch({ client_id: CLAUDE_CODE, redirect_uris: ['http://localhost/callback'], token_endpoint_auth_method: 'none' })
    const client = await loadClient(CLAUDE_CODE, { origins: ORIGINS, fetch })
    expect(client).toEqual({ clientId: CLAUDE_CODE, host: 'claude.ai', redirectUris: ['http://localhost/callback'] })
  })

  it('허용하지 않은 출처는 읽으러 가지도 않는다', async () => {
    const fetch = jsonFetch({})
    await expect(loadClient('https://evil.example/c', { origins: ORIGINS, fetch })).rejects.toThrow('허용하지 않은')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('문서의 client_id 가 다르거나, 돌아갈 주소가 없거나, 비밀을 쓰는 클라이언트면 거절', async () => {
    await expect(loadClient(CLAUDE_CODE, { origins: ORIGINS, fetch: jsonFetch({ client_id: 'https://claude.ai/other', redirect_uris: ['x'] }) })).rejects.toThrow('client_id')
    clearClientCache()
    await expect(loadClient(CLAUDE_CODE, { origins: ORIGINS, fetch: jsonFetch({ client_id: CLAUDE_CODE }) })).rejects.toThrow('redirect_uris')
    clearClientCache()
    await expect(
      loadClient(CLAUDE_CODE, { origins: ORIGINS, fetch: jsonFetch({ client_id: CLAUDE_CODE, redirect_uris: ['x'], token_endpoint_auth_method: 'client_secret_basic' }) }),
    ).rejects.toThrow('공개 클라이언트')
    clearClientCache()
    await expect(loadClient(CLAUDE_CODE, { origins: ORIGINS, fetch: jsonFetch({}, 404) })).rejects.toThrow('읽지 못했습니다')
  })

  it('돌아갈 주소: 정확히 같아야 하고, 루프백만 포트를 보지 않는다', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback', 'http://127.0.0.1/callback']
    expect(redirectAllowed('https://claude.ai/api/mcp/auth_callback', registered)).toBe(true)
    expect(redirectAllowed('http://localhost:3118/callback', registered)).toBe(true)
    expect(redirectAllowed('http://127.0.0.1:51234/callback', registered)).toBe(true)
    expect(redirectAllowed('http://localhost:3118/other', registered)).toBe(false)
    expect(redirectAllowed('https://claude.ai:8443/api/mcp/auth_callback', registered)).toBe(false)
    expect(redirectAllowed('https://evil.example/api/mcp/auth_callback', registered)).toBe(false)
    expect(redirectAllowed('http://localhost.evil.example:3118/callback', registered)).toBe(false)
  })

  it('PKCE S256 (RFC 7636 예시)', () => {
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true)
    expect(verifyPkce(`${VERIFIER.slice(0, -1)}A`, CHALLENGE)).toBe(false)
    expect(verifyPkce('짧음', CHALLENGE)).toBe(false)
  })
})

describe('승인·토큰 (OAuthGrants)', () => {
  let dir: string
  let now: number
  let grants: OAuthGrants
  const request = { clientId: CLAUDE_CODE, clientHost: 'claude.ai', redirectUri: 'http://localhost:3118/callback', state: 's', codeChallenge: CHALLENGE, scope: 'memo', resource: RESOURCE }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memo-oauth-'))
    now = Date.UTC(2026, 9, 16, 12)
    grants = new OAuthGrants(join(dir, 'oauth'), () => now)
    await grants.init()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function connect() {
    const id = grants.createRequest(request)
    const approved = grants.approve(id)!
    return grants.exchangeCode({ code: approved.code, clientId: CLAUDE_CODE, redirectUri: request.redirectUri, codeVerifier: VERIFIER, resource: RESOURCE })
  }

  it('승인 → 코드 교환 → 접근 토큰이 MCP 주소에서만, 1시간 동안 통한다', async () => {
    const tokens = await connect()
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: ACCESS_TTL_S, scope: 'memo' })
    expect(grants.verifyAccess(tokens.access_token, RESOURCE)).toMatchObject({ cid: CLAUDE_CODE, scope: 'memo' })
    expect(grants.verifyAccess(tokens.access_token, 'https://other.example/mcp')).toBeNull()
    expect(grants.verifyAccess(`${tokens.access_token}x`, RESOURCE)).toBeNull()
    now += ACCESS_TTL_S * 1000
    expect(grants.verifyAccess(tokens.access_token, RESOURCE)).toBeNull()
  })

  it('코드는 한 번만, 1분 안에, 승인 때와 같은 클라이언트·주소·resource·PKCE 로만', async () => {
    const id = grants.createRequest(request)
    const { code } = grants.approve(id)!
    const base = { code, clientId: CLAUDE_CODE, redirectUri: request.redirectUri, codeVerifier: VERIFIER, resource: RESOURCE }
    await expect(grants.exchangeCode({ ...base, codeVerifier: `${VERIFIER.slice(0, -1)}A` })).rejects.toMatchObject({ code: 'invalid_grant' })
    // 실패해도 코드는 지워진다
    await expect(grants.exchangeCode(base)).rejects.toMatchObject({ code: 'invalid_grant' })

    for (const wrong of [{ clientId: 'https://claude.ai/x' }, { redirectUri: 'http://localhost:9/callback' }, { resource: 'https://other/mcp' }]) {
      const again = grants.approve(grants.createRequest(request))!
      await expect(grants.exchangeCode({ ...base, code: again.code, ...wrong })).rejects.toMatchObject({ code: 'invalid_grant' })
    }
    const late = grants.approve(grants.createRequest(request))!
    now += 61_000
    await expect(grants.exchangeCode({ ...base, code: late.code })).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('승인 요청은 10분, 거절하면 사라진다', () => {
    const id = grants.createRequest(request)
    expect(grants.getRequest(id)).toMatchObject({ clientHost: 'claude.ai' })
    expect(grants.deny(id)).toMatchObject({ redirectUri: request.redirectUri })
    expect(grants.getRequest(id)).toBeNull()
    const late = grants.createRequest(request)
    now += 10 * 60 * 1000 + 1
    expect(grants.approve(late)).toBeNull()
  })

  it('갱신 토큰은 쓸 때마다 바뀌고, 이미 바꾼 것이 다시 오면 그 연결을 끊는다', async () => {
    const first = await connect()
    const second = await grants.refresh({ refreshToken: first.refresh_token, clientId: CLAUDE_CODE, resource: RESOURCE })
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect(grants.verifyAccess(second.access_token, RESOURCE)).not.toBeNull()

    await expect(grants.refresh({ refreshToken: first.refresh_token, clientId: CLAUDE_CODE, resource: RESOURCE })).rejects.toMatchObject({ code: 'invalid_grant' })
    expect(grants.connections()).toEqual([])
    expect(grants.verifyAccess(second.access_token, RESOURCE)).toBeNull()
    await expect(grants.refresh({ refreshToken: second.refresh_token, clientId: CLAUDE_CODE, resource: RESOURCE })).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('갱신 토큰은 다른 클라이언트·만료 후에는 안 된다', async () => {
    const tokens = await connect()
    await expect(grants.refresh({ refreshToken: tokens.refresh_token, clientId: 'https://claude.ai/x', resource: null })).rejects.toMatchObject({ code: 'invalid_grant' })
    now += REFRESH_TTL_MS + 1
    await expect(grants.refresh({ refreshToken: tokens.refresh_token, clientId: CLAUDE_CODE, resource: null })).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('끊기: 하나 / 전부(서명 키도 바꿔 나간 접근 토큰까지 무효)', async () => {
    const a = await connect()
    const b = await connect()
    expect(grants.connections()).toHaveLength(2)
    const idA = grants.verifyAccess(a.access_token, RESOURCE)!.fam
    await grants.revoke(idA)
    expect(grants.verifyAccess(a.access_token, RESOURCE)).toBeNull()
    expect(grants.verifyAccess(b.access_token, RESOURCE)).not.toBeNull()
    await grants.revokeAll()
    expect(grants.verifyAccess(b.access_token, RESOURCE)).toBeNull()
    expect(grants.connections()).toEqual([])
  })

  it('서버가 다시 떠도 연결이 이어진다. 파일은 600', async () => {
    const tokens = await connect()
    const reloaded = new OAuthGrants(join(dir, 'oauth'), () => now)
    await reloaded.init()
    expect(reloaded.verifyAccess(tokens.access_token, RESOURCE)).not.toBeNull()
    await expect(reloaded.refresh({ refreshToken: tokens.refresh_token, clientId: CLAUDE_CODE, resource: RESOURCE })).resolves.toMatchObject({ token_type: 'Bearer' })
    for (const file of ['key', 'grants.json']) expect((await stat(join(dir, 'oauth', file))).mode & 0o777).toBe(0o600)
  })
})
