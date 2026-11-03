import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const requireSession = vi.fn<() => Promise<void>>()
const headers = new Map<string, string>()
let path = '/'
let handle: typeof import('./auth').default

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
  vi.stubGlobal('getRequestURL', () => new URL(path, 'http://localhost'))
  vi.stubGlobal('setResponseHeader', (_event: object, name: string, value: string) => headers.set(name, value))
  vi.stubGlobal('requireUserSession', requireSession)
  handle = (await import('./auth')).default
})

afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  headers.clear()
  requireSession.mockReset().mockResolvedValue(undefined)
})

async function request(target: string) {
  path = target
  // 이 미들웨어는 h3 이벤트를 직접 읽지 않는다. URL/헤더/인증 어댑터만 교체한다.
  await handle({} as Parameters<typeof handle>[0])
}

describe('인증·개인 API의 캐시 경계', () => {
  it.each(['/api/_auth/session', '/api/auth/login'])('로그인 전에도 여는 %s 응답은 캐시에 남지 않는다', async (target) => {
    await request(target)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(requireSession).not.toHaveBeenCalled()
  })

  it('인증된 메모 조회도 캐시에 남지 않는다', async () => {
    await request('/api/memos/fixture')
    expect(headers.get('cache-control')).toBe('no-store')
    expect(requireSession).toHaveBeenCalledOnce()
  })

  it('인증 거절 전에 캐시 금지를 설정한다', async () => {
    requireSession.mockRejectedValue(new Error('unauthenticated'))
    await expect(request('/api/memos/fixture')).rejects.toThrow('unauthenticated')
    expect(headers.get('cache-control')).toBe('no-store')
  })

  it('일반 화면의 캐시 정책과 인증 경계는 건드리지 않는다', async () => {
    await request('/login')
    expect(headers.has('cache-control')).toBe(false)
    expect(requireSession).not.toHaveBeenCalled()
  })
})
