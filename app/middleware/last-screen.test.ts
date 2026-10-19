import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('최초 진입 화면 복원 미들웨어', () => {
  const states = new Map<string, { value: unknown }>()
  let restore: ReturnType<typeof vi.fn>
  let navigate: ReturnType<typeof vi.fn>
  beforeEach(() => {
    states.clear()
    restore = vi.fn().mockResolvedValue('/todo')
    navigate = vi.fn((path, options) => ({ path, options }))
    vi.stubGlobal('defineNuxtRouteMiddleware', (callback: unknown) => callback)
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, { value: init() })
      return states.get(key)
    })
    vi.stubGlobal('useUserSession', () => ({ loggedIn: { value: true } }))
    vi.stubGlobal('useLastScreen', () => ({ restore }))
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('window', { location: { pathname: '/', search: '', hash: '' } })
  })
  afterEach(() => vi.unstubAllGlobals())
  async function middleware() {
    return (await import('./last-screen.global')).default
  }
  // Nuxt 런타임 없는 좁은 가드 테스트. to의 fullPath 외 필드는 이 미들웨어에서 쓰지 않는다.
  const route = (path: string) => ({ fullPath: path }) as Parameters<Awaited<ReturnType<typeof middleware>>>[0]

  it('replace 한 번으로 복원하고 재호출이나 앱 안에서 홈 이동은 복원하지 않는다', async () => {
    const run = await middleware()
    await run(route('/'), route('/'))
    expect(navigate).toHaveBeenCalledWith('/todo', { replace: true })
    await run(route('/todo'), route('/'))
    await run(route('/'), route('/todo'))
    expect(restore).toHaveBeenCalledTimes(1)
  })

  it.each(['/m/deep', '/tags?tag=work', '/oauth/consent?request=id', '/login'])('명시적 진입 %s는 유지한다', async (path) => {
    const run = await middleware()
    await run(route(path), route('/'))
    expect(restore).not.toHaveBeenCalled()
  })

  it('주소의 query/hash나 비로그인 세션을 덮지 않는다', async () => {
    const run = await middleware()
    vi.stubGlobal('window', { location: { pathname: '/', search: '?source=share', hash: '' } })
    await run(route('/?source=share'), route('/'))
    expect(restore).not.toHaveBeenCalled()
    states.clear()
    vi.stubGlobal('window', { location: { pathname: '/', search: '', hash: '' } })
    vi.stubGlobal('useUserSession', () => ({ loggedIn: { value: false } }))
    await run(route('/'), route('/'))
    expect(restore).not.toHaveBeenCalled()
  })

  it('검증하는 동안 사용자가 새 주소로 이동하면 늦은 복원이 덮지 않는다', async () => {
    let resolve!: (path: string) => void
    restore.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const run = await middleware()
    const initial = run(route('/'), route('/'))
    await run(route('/calendar'), route('/'))
    resolve('/todo')
    await initial
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each([null, '/'])('손상/기본 화면 %s에는 리다이렉트하지 않는다', async (path) => {
    restore.mockResolvedValue(path)
    const run = await middleware()
    await run(route('/'), route('/'))
    expect(navigate).not.toHaveBeenCalled()
  })
})
