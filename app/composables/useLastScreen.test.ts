import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LAST_SCREEN_KEY } from '../utils/last-screen'
import { useLastScreen } from './useLastScreen'

describe('마지막 화면 저장소와 비동기 검증', () => {
  let session: { value: unknown }
  let storage: Map<string, string>
  let fetchTree: ReturnType<typeof vi.fn>
  beforeEach(() => {
    session = { value: { id: 'one', user: { owner: true }, loggedInAt: 100 } }
    storage = new Map()
    fetchTree = vi.fn().mockResolvedValue({ memos: [{ id: 'a', tags: ['work'], unreadable: false }] })
    vi.stubGlobal('useUserSession', () => ({ session }))
    vi.stubGlobal('$fetch', fetchTree)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('검증된 화면만 저장하고 다른 화면 방문은 마지막 허용 화면을 유지한다', async () => {
    const last = useLastScreen()
    await last.remember('/m/a', () => true)
    expect(await last.restore()).toBe('/m/a')
    await last.remember('/ai', () => true)
    expect(await last.restore()).toBe('/m/a')
    await last.remember('/m/deleted', () => true)
    expect(await last.restore()).toBe('/m/a')
  })

  it('삭제·권한 변경·서버 검증 실패 시 저장을 지우고 기본 화면으로 돌아간다', async () => {
    const last = useLastScreen()
    await last.remember('/tags?tag=work', () => true)
    fetchTree.mockRejectedValue(new Error('403'))
    expect(await last.restore()).toBeNull()
    expect(storage.size).toBe(0)
  })

  it('로그아웃·세션 전환 시 이전 화면이 복원되지 않는다', async () => {
    const last = useLastScreen()
    await last.remember('/m/a', () => true)
    session.value = { id: 'two', user: { owner: true }, loggedInAt: 200 }
    expect(await last.restore()).toBeNull()
    expect(storage.size).toBe(0)
    await last.remember('/todo', () => true)
    session.value = null
    await last.remember('/todo', () => true)
    expect(storage.size).toBe(0)
  })

  it('늦게 끝난 이전 화면/이전 세션 검증은 새 상태를 덮지 않는다', async () => {
    let resolve!: (tree: unknown) => void
    fetchTree.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const last = useLastScreen()
    const old = last.remember('/m/a', () => false)
    await last.remember('/calendar', () => true)
    resolve({ memos: [{ id: 'a', unreadable: false }] })
    await old
    expect(await last.restore()).toBe('/calendar')
    fetchTree.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    const priorSession = last.remember('/m/a', () => true)
    session.value = { id: 'two', user: { owner: true }, loggedInAt: 200 }
    resolve({ memos: [{ id: 'a', unreadable: false }] })
    await priorSession
    expect(storage.get(LAST_SCREEN_KEY)).not.toContain('owner:two')
  })

  it('브라우저 저장소가 차단되어도 현재 이동은 실패하지 않는다', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('blocked') },
    })
    const last = useLastScreen()
    await expect(last.remember('/todo', () => true)).resolves.toBeUndefined()
    await expect(last.restore()).resolves.toBeNull()
    expect(() => last.forget()).not.toThrow()
  })
})
