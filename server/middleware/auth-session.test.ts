import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const clear = vi.fn<() => Promise<void>>()
const remove = vi.fn()
const header = vi.fn()
let path = '/api/_auth/session'
let handle: typeof import('./auth-session').default

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)
  vi.stubGlobal('getRequestURL', () => new URL(path, 'http://localhost'))
  vi.stubGlobal('setResponseHeader', header)
  vi.stubGlobal('clearUserSession', clear)
  vi.stubGlobal('deleteCookie', remove)
  vi.stubGlobal('useRuntimeConfig', () => ({ session: { name: 'fixture-session' } }))
  handle = (await import('./auth-session')).default
})
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  path = '/api/_auth/session'
  clear.mockReset().mockResolvedValue(undefined)
  remove.mockClear()
  header.mockClear()
})

async function request(method: string) {
  return handle({ method } as Parameters<typeof handle>[0])
}

describe('로그아웃 영속 쿠키 삭제', () => {
  it('기존 로그아웃 훅을 완료한 뒤 설정된 이름의 루트 쿠키를 삭제한다', async () => {
    expect(await request('DELETE')).toBe(true)
    expect(clear).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith(expect.any(Object), 'fixture-session', { path: '/' })
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]!)
    expect(header).toHaveBeenCalledWith(expect.any(Object), 'cache-control', 'no-store')
  })

  it('세션 조회는 기존 라이브러리 핸들러가 처리한다', async () => {
    expect(await request('GET')).toBeUndefined()
    expect(clear).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('다른 DELETE API는 가로채지 않는다', async () => {
    path = '/api/memos/fixture'
    expect(await request('DELETE')).toBeUndefined()
    expect(clear).not.toHaveBeenCalled()
  })

  it('기존 로그아웃 훅 오류를 숨기지 않는다', async () => {
    clear.mockRejectedValue(new Error('clear failed'))
    await expect(request('DELETE')).rejects.toThrow('clear failed')
    expect(remove).not.toHaveBeenCalled()
  })
})
