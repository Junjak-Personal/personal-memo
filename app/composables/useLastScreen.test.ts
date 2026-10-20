import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoMeta, TreeResponse } from '#shared/types/memo'
import { LAST_SCREEN_KEY, screenScope } from '../utils/last-screen'
import { createSessionTree } from '../utils/session-tree'
import { useLastScreen } from './useLastScreen'

function testTree(memos: Array<Partial<MemoMeta> & Pick<MemoMeta, 'id'>>): TreeResponse {
  return {
    folders: [], orders: {}, todoOrder: [],
    memos: memos.map((memo) => ({
      path: '', folder: '', title: '', created: null, updated: null, date: null, dateEnd: null,
      tags: [], done: null, public: false, unreadable: false, ...memo,
    })),
  }
}

describe('마지막 화면 저장소와 비동기 검증', () => {
  let session: { value: unknown }
  let storage: Map<string, string>
  let fetchTree: ReturnType<typeof vi.fn<() => Promise<TreeResponse>>>
  let shared: ReturnType<typeof createSessionTree>
  beforeEach(() => {
    session = { value: { id: 'one', user: { owner: true }, loggedInAt: 100 } }
    storage = new Map()
    fetchTree = vi.fn<() => Promise<TreeResponse>>().mockResolvedValue(testTree([{ id: 'a', tags: ['work'], unreadable: false }]))
    let tree: Awaited<ReturnType<typeof shared.ensure>> | null = null
    shared = createSessionTree({
      scope: () => screenScope(session.value),
      tree: () => tree,
      setTree: (next) => { tree = next },
      setError: () => {},
      fetch: () => fetchTree(),
      message: () => '목록 오류',
    })
    vi.stubGlobal('useUserSession', () => ({ session }))
    vi.stubGlobal('useMemoTree', () => shared)
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
    expect(fetchTree).toHaveBeenCalledTimes(1)
    await last.remember('/ai', () => true)
    expect(await last.restore()).toBe('/m/a')
    await last.remember('/m/deleted', () => true)
    expect(await last.restore()).toBe('/m/a')
  })

  it('삭제·권한 변경·서버 검증 실패 시 저장을 지우고 기본 화면으로 돌아간다', async () => {
    const last = useLastScreen()
    await last.remember('/tags?tag=work', () => true)
    fetchTree.mockRejectedValue(new Error('403'))
    await shared.refresh()
    expect(await last.restore()).toBeNull()
    expect(storage.size).toBe(0)
  })

  it.each([
    ['/m/deleted', { id: 'a', tags: ['work'], unreadable: false }],
    ['/m/a', { id: 'a', tags: ['work'], unreadable: true }],
    ['/tags?tag=missing', { id: 'a', tags: ['work'], unreadable: false }],
    ['/tags?tag=work', { id: 'a', tags: ['work'], unreadable: true }],
  ])('새 앱 첫 조회에서 사용할 수 없는 %s 화면을 복원하지 않는다', async (path, memo) => {
    storage.set(LAST_SCREEN_KEY, JSON.stringify({ version: 1, scope: screenScope(session.value), path }))
    fetchTree.mockResolvedValue(testTree([memo]))
    expect(await useLastScreen().restore()).toBeNull()
    expect(storage.size).toBe(0)
  })

  it('복원·사이드바·연속 화면 저장이 같은 진행 중인 조회를 기다린다', async () => {
    let resolve!: (tree: TreeResponse) => void
    fetchTree.mockImplementationOnce(() => new Promise<TreeResponse>((done) => { resolve = done }))
    storage.set(LAST_SCREEN_KEY, JSON.stringify({ version: 1, scope: screenScope(session.value), path: '/m/a' }))
    const last = useLastScreen()
    const restoring = last.restore()
    const sidebar = shared.ensure()
    const remembering = last.remember('/tags?tag=work', () => true)
    await Promise.resolve()
    expect(fetchTree).toHaveBeenCalledTimes(1)
    resolve(testTree([{ id: 'a', tags: ['work'], unreadable: false }]))
    await Promise.all([sidebar, remembering])
    expect(await restoring).toBe('/m/a')
    expect(await last.restore()).toBe('/tags?tag=work')
    expect(fetchTree).toHaveBeenCalledTimes(1)
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

  it('이전 세션의 늦은 복원 실패가 새 세션의 저장 화면을 지우지 않는다', async () => {
    let resolve!: (tree: TreeResponse) => void
    fetchTree.mockImplementationOnce(() => new Promise<TreeResponse>((done) => { resolve = done }))
    storage.set(LAST_SCREEN_KEY, JSON.stringify({ version: 1, scope: screenScope(session.value), path: '/m/a' }))
    const last = useLastScreen()
    const restoring = last.restore()
    await Promise.resolve()
    session.value = { id: 'two', user: { owner: true }, loggedInAt: 200 }
    await last.remember('/calendar', () => true)
    const newer = storage.get(LAST_SCREEN_KEY)
    resolve(testTree([{ id: 'a', tags: ['work'], unreadable: false }]))
    expect(await restoring).toBeNull()
    expect(storage.get(LAST_SCREEN_KEY)).toBe(newer)
    expect(await last.restore()).toBe('/calendar')
  })

  it('같은 세션에서도 늦은 복원 실패가 새 화면의 저장값을 지우지 않는다', async () => {
    let resolve!: (tree: TreeResponse) => void
    fetchTree.mockImplementationOnce(() => new Promise<TreeResponse>((done) => { resolve = done }))
    storage.set(LAST_SCREEN_KEY, JSON.stringify({ version: 1, scope: screenScope(session.value), path: '/m/deleted' }))
    const last = useLastScreen()
    const restoring = last.restore()
    await Promise.resolve()
    await last.remember('/calendar', () => true)
    const newer = storage.get(LAST_SCREEN_KEY)
    resolve(testTree([{ id: 'a', tags: ['work'], unreadable: false }]))
    expect(await restoring).toBeNull()
    expect(storage.get(LAST_SCREEN_KEY)).toBe(newer)
    expect(await last.restore()).toBe('/calendar')
  })

  it('늦게 끝난 이전 화면/이전 세션 검증은 새 상태를 덮지 않는다', async () => {
    let resolve!: (tree: TreeResponse) => void
    fetchTree.mockImplementationOnce(() => new Promise<TreeResponse>((done) => { resolve = done }))
    const last = useLastScreen()
    const old = last.remember('/m/a', () => false)
    await last.remember('/calendar', () => true)
    await Promise.resolve()
    resolve(testTree([{ id: 'a', unreadable: false }]))
    await old
    expect(await last.restore()).toBe('/calendar')
    fetchTree.mockImplementationOnce(() => new Promise<TreeResponse>((done) => { resolve = done }))
    const refresh = shared.refresh()
    const priorSession = last.remember('/m/a', () => true)
    await Promise.resolve()
    session.value = { id: 'two', user: { owner: true }, loggedInAt: 200 }
    resolve(testTree([{ id: 'a', unreadable: false }]))
    await priorSession
    await refresh
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
