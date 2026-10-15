/**
 * OAuth 승인·토큰·연결 (설계: _docs/active/planning/2026-10-16-mcp-connector.md).
 *
 * - 접근 토큰: 서명한 토큰(HMAC-SHA256). 서버에 남기지 않는다. 받을 곳(aud = MCP 주소)·만료·연결이 살아 있는지 검사한다. 1시간.
 * - 갱신 토큰: 무작위 값. 서버에는 SHA-256 해시만 둔다. 쓸 때마다 새것으로 바꾸고(회전), 이미 바꾼 것을 다시 쓰면
 *   그 연결을 통째로 끊는다 — 누가 훔쳐 쓴 것으로 본다 (OAuth 2.1 공개 클라이언트 규칙). 60일.
 * - 승인 코드·대기 중인 승인 요청: 메모리 (1분·10분). 서버가 다시 뜨면 진행 중이던 승인만 다시 하면 된다.
 * - 끊기: 연결 하나 또는 전부. 전부 끊을 때는 서명 키도 바꿔 이미 나간 접근 토큰까지 바로 무효로 만든다.
 *
 * 저장: <dataDir>/oauth/{key, grants.json} — 메모 백업(memos/) 밖, 600 권한. Nuxt 없이 Vitest 로 검사한다.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomic } from '../memo/fsx'
import { verifyPkce } from './client'

export const ACCESS_TTL_S = 60 * 60
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000
const REQUEST_TTL_MS = 10 * 60 * 1000
const CODE_TTL_MS = 60 * 1000

export interface AuthRequest {
  clientId: string
  clientHost: string
  redirectUri: string
  state: string | null
  codeChallenge: string
  scope: string
  resource: string
}

export interface AccessClaims {
  /** 받을 곳 — MCP 주소 */
  aud: string
  scope: string
  /** client_id */
  cid: string
  /** 연결 id — 끊으면 이 연결의 접근 토큰도 바로 무효 */
  fam: string
  /** 만료 (초) */
  exp: number
}

export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

export interface Connection {
  id: string
  clientHost: string
  createdAt: string
  lastUsedAt: string
}

/** 토큰 끝점의 오류 — RFC 6749 의 error 코드 그대로 (갱신 실패는 invalid_grant 여야 Claude 가 다시 로그인을 띄운다) */
export class OAuthGrantError extends Error {
  constructor(
    readonly code: 'invalid_grant' | 'invalid_request' | 'unsupported_grant_type',
    message: string,
  ) {
    super(message)
  }
}

interface Family {
  clientId: string
  clientHost: string
  scope: string
  resource: string
  createdAt: number
  lastUsedAt: number
}

interface GrantsFile {
  families: Record<string, Family>
  /** 해시 → 살아 있는 갱신 토큰 */
  refresh: Record<string, { family: string; expiresAt: number }>
  /** 해시 → 이미 바꾼 갱신 토큰 (다시 오면 도난으로 본다) */
  used: Record<string, { family: string; until: number }>
}

const hash = (value: string) => createHash('sha256').update(value).digest('base64url')
const token = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`

export class OAuthGrants {
  private key = Buffer.alloc(0)
  private data: GrantsFile = { families: {}, refresh: {}, used: {} }
  private readonly requests = new Map<string, AuthRequest & { at: number }>()
  private readonly codes = new Map<string, AuthRequest & { at: number }>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  async init() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    try {
      this.key = Buffer.from((await readFile(join(this.dir, 'key'), 'utf8')).trim(), 'base64url')
    } catch {
      await this.rotateKey()
    }
    if (this.key.length < 32) await this.rotateKey()
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.dir, 'grants.json'), 'utf8'))
      if (isGrantsFile(parsed)) this.data = parsed
    } catch {
      // 처음이거나 깨졌다 — 빈 상태로 시작한다(연결만 다시 하면 된다)
    }
  }

  // ── 승인 요청 (승인 화면이 읽는다) ─────────────────────────────────────

  createRequest(request: AuthRequest) {
    this.sweep()
    const id = randomBytes(16).toString('base64url')
    this.requests.set(id, { ...request, at: this.now() })
    return id
  }

  getRequest(id: string): AuthRequest | null {
    const request = this.requests.get(id)
    if (!request || this.now() - request.at > REQUEST_TTL_MS) return null
    return request
  }

  /** 허용 → 승인 코드 (한 번만, 1분). 요청은 지운다 */
  approve(id: string) {
    const request = this.getRequest(id)
    if (!request) return null
    this.requests.delete(id)
    const code = token('mac_')
    this.codes.set(hash(code), { ...request, at: this.now() })
    return { code, request }
  }

  deny(id: string) {
    const request = this.getRequest(id)
    this.requests.delete(id)
    return request
  }

  // ── 토큰 끝점 ───────────────────────────────────────────────────────

  exchangeCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string | null }) {
    return this.exclusive(async () => {
      const key = hash(input.code)
      const grant = this.codes.get(key)
      // 한 번 쓰면 지운다 — 같은 코드를 두 번 내밀어도 두 번째는 실패
      this.codes.delete(key)
      if (!grant || this.now() - grant.at > CODE_TTL_MS) throw new OAuthGrantError('invalid_grant', '승인 코드가 없거나 만료됐습니다')
      if (grant.clientId !== input.clientId) throw new OAuthGrantError('invalid_grant', '승인 코드의 클라이언트가 다릅니다')
      if (grant.redirectUri !== input.redirectUri) throw new OAuthGrantError('invalid_grant', 'redirect_uri 가 승인 때와 다릅니다')
      if (input.resource !== null && input.resource !== grant.resource) throw new OAuthGrantError('invalid_grant', 'resource 가 승인 때와 다릅니다')
      if (!verifyPkce(input.codeVerifier, grant.codeChallenge)) throw new OAuthGrantError('invalid_grant', 'PKCE 확인에 실패했습니다')

      const family = randomBytes(12).toString('base64url')
      const now = this.now()
      this.data.families[family] = {
        clientId: grant.clientId,
        clientHost: grant.clientHost,
        scope: grant.scope,
        resource: grant.resource,
        createdAt: now,
        lastUsedAt: now,
      }
      const response = this.issue(family)
      await this.persist()
      return response
    })
  }

  refresh(input: { refreshToken: string; clientId: string; resource: string | null }) {
    return this.exclusive(async () => {
      const key = hash(input.refreshToken)
      const used = this.data.used[key]
      if (used) {
        // 이미 바꾼 토큰이 또 왔다 — 훔쳐 간 쪽이 있을 수 있으니 이 연결을 끊는다
        this.dropFamily(used.family)
        await this.persist()
        throw new OAuthGrantError('invalid_grant', '이미 쓴 갱신 토큰입니다 — 연결을 끊었습니다')
      }
      const record = this.data.refresh[key]
      const family = record && this.data.families[record.family]
      if (!record || !family || record.expiresAt < this.now()) throw new OAuthGrantError('invalid_grant', '갱신 토큰이 없거나 만료됐습니다')
      if (family.clientId !== input.clientId) throw new OAuthGrantError('invalid_grant', '갱신 토큰의 클라이언트가 다릅니다')
      if (input.resource !== null && input.resource !== family.resource) throw new OAuthGrantError('invalid_grant', 'resource 가 다릅니다')

      delete this.data.refresh[key]
      this.data.used[key] = { family: record.family, until: record.expiresAt }
      family.lastUsedAt = this.now()
      const response = this.issue(record.family)
      await this.persist()
      return response
    })
  }

  // ── MCP 요청 ────────────────────────────────────────────────────────

  verifyAccess(accessToken: string, audience: string): AccessClaims | null {
    const [body, sig] = accessToken.split('.')
    if (!body || !sig || accessToken.split('.').length !== 2) return null
    const expected = Buffer.from(this.sign(body))
    const given = Buffer.from(sig)
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
    let claims: unknown
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    } catch {
      return null
    }
    if (!isClaims(claims)) return null
    if (claims.aud !== audience || claims.exp * 1000 <= this.now()) return null
    const family = this.data.families[claims.fam]
    if (!family) return null
    family.lastUsedAt = this.now()
    return claims
  }

  // ── 연결 관리 (화면) ─────────────────────────────────────────────────

  connections(): Connection[] {
    return Object.entries(this.data.families)
      .map(([id, f]) => ({ id, clientHost: f.clientHost, createdAt: new Date(f.createdAt).toISOString(), lastUsedAt: new Date(f.lastUsedAt).toISOString() }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
  }

  revoke(id: string) {
    return this.exclusive(async () => {
      this.dropFamily(id)
      await this.persist()
    })
  }

  /** 모든 연결을 끊는다 — 서명 키도 바꿔 이미 나간 접근 토큰까지 무효 */
  revokeAll() {
    return this.exclusive(async () => {
      this.data = { families: {}, refresh: {}, used: {} }
      this.codes.clear()
      this.requests.clear()
      await this.rotateKey()
      await this.persist()
    })
  }

  // ── 안쪽 ────────────────────────────────────────────────────────────

  private issue(family: string): TokenResponse {
    const f = this.data.families[family]!
    const claims: AccessClaims = { aud: f.resource, scope: f.scope, cid: f.clientId, fam: family, exp: Math.floor(this.now() / 1000) + ACCESS_TTL_S }
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const refresh = token('mrt_')
    this.data.refresh[hash(refresh)] = { family, expiresAt: this.now() + REFRESH_TTL_MS }
    return { access_token: `${body}.${this.sign(body)}`, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: f.scope }
  }

  private sign(body: string) {
    return createHmac('sha256', this.key).update(body).digest('base64url')
  }

  private dropFamily(id: string) {
    delete this.data.families[id]
    for (const [key, r] of Object.entries(this.data.refresh)) if (r.family === id) delete this.data.refresh[key]
    for (const [key, u] of Object.entries(this.data.used)) if (u.family === id) delete this.data.used[key]
  }

  private async rotateKey() {
    this.key = randomBytes(32)
    const path = join(this.dir, 'key')
    await writeFile(path, this.key.toString('base64url'), { mode: 0o600 })
    await chmod(path, 0o600)
  }

  private async persist() {
    this.sweep()
    const path = join(this.dir, 'grants.json')
    await writeAtomic(path, JSON.stringify(this.data))
    await chmod(path, 0o600)
  }

  /** 만료된 것 치우기 — 갱신 토큰이 하나도 안 남은 연결은 끝난 연결이다 */
  private sweep() {
    const now = this.now()
    for (const [id, r] of this.requests) if (now - r.at > REQUEST_TTL_MS) this.requests.delete(id)
    for (const [id, c] of this.codes) if (now - c.at > CODE_TTL_MS) this.codes.delete(id)
    for (const [key, r] of Object.entries(this.data.refresh)) if (r.expiresAt < now) delete this.data.refresh[key]
    for (const [key, u] of Object.entries(this.data.used)) if (u.until < now) delete this.data.used[key]
    const alive = new Set(Object.values(this.data.refresh).map((r) => r.family))
    for (const id of Object.keys(this.data.families)) if (!alive.has(id)) delete this.data.families[id]
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => undefined)
    return run
  }
}

function isClaims(value: unknown): value is AccessClaims {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return typeof c.aud === 'string' && typeof c.scope === 'string' && typeof c.cid === 'string' && typeof c.fam === 'string' && typeof c.exp === 'number'
}

function isGrantsFile(value: unknown): value is GrantsFile {
  if (typeof value !== 'object' || value === null) return false
  const g = value as Record<string, unknown>
  return [g.families, g.refresh, g.used].every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))
}
