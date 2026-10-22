import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MemoMeta } from '../../shared/types/memo'
import { MAX_FAVORITE_MEMOS, MAX_RECENT_MEMOS } from '../../shared/types/memo-navigation'
import { MemoNavigationStore, NAVIGATION_FILE, navigationId, parseNavigationInput } from './navigation'

const meta = (id: string, extra: Partial<MemoMeta> = {}): MemoMeta => ({
  id, title: `제목 ${id}`, folder: '', path: `${id}.md`, created: null, updated: null,
  date: null, dateEnd: null, tags: [], done: null, priority: 'medium', public: false, unreadable: false, ...extra,
})

describe('최근 메모·즐겨찾기 저장소', () => {
  let root: string
  let memos: MemoMeta[]
  let store: MemoNavigationStore
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memo-navigation-'))
    memos = Array.from({ length: 120 }, (_, index) => meta(String(index)))
    store = new MemoNavigationStore(root, async () => memos)
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('최근 방문 중복을 맨 앞으로 옮기고 상한을 유지하며 재시작 뒤에도 읽는다', async () => {
    expect(await store.get()).toEqual({ recent: [], favorites: [] })
    for (let n = 0; n <= MAX_RECENT_MEMOS; n++) await store.opened(String(n))
    await store.opened('4')
    const restarted = new MemoNavigationStore(root, async () => memos)
    const state = await restarted.get()
    expect(state.recent[0]).toBe('4')
    expect(state.recent).toHaveLength(MAX_RECENT_MEMOS)
    expect(state.recent).not.toContain('0')
    expect(new Set(state.recent).size).toBe(MAX_RECENT_MEMOS)
  })

  it('별표는 중복 없이 유지하고 제목·본문·폴더 대신 ID만 보관한다', async () => {
    await store.favorite('1', true)
    await store.favorite('1', true)
    await store.opened('2')
    expect(await store.get()).toEqual({ recent: ['2'], favorites: ['1'] })
    const file = await readFile(join(root, NAVIGATION_FILE), 'utf8')
    expect(JSON.parse(file)).toEqual({ version: 1, recent: ['2'], favorites: ['1'] })
    expect(file).not.toContain('제목')
    expect((await store.favorite('1', false)).favorites).toEqual([])
  })

  it('동시 방문·별표 변경이 서로의 목록을 잃지 않는다', async () => {
    await Promise.all([store.opened('1'), store.favorite('2', true), store.opened('3'), store.favorite('4', true)])
    expect(await store.get()).toEqual({ recent: ['3', '1'], favorites: ['2', '4'] })
  })

  it('없는 메모·읽기 불가 항목은 표시/추가하지 않고 이름·폴더 변경은 ID를 유지한다', async () => {
    await store.opened('1')
    await store.favorite('2', true)
    memos = [meta('1', { title: '새 제목', folder: '이동' }), meta('2', { unreadable: true })]
    expect(await store.get()).toEqual({ recent: ['1'], favorites: [] })
    await expect(store.opened('2')).rejects.toMatchObject({ code: 'not_found' })
    await expect(store.favorite('missing', true)).rejects.toMatchObject({ code: 'not_found' })
    memos = []
    expect(await store.get()).toEqual({ recent: [], favorites: [] })
  })

  it('외부 파일 첫 저장의 p: ID를 새 ID로 바꿔 별표를 보존한다', async () => {
    memos = [meta('p:외부.md')]
    await store.favorite('p:외부.md', true)
    await store.opened('p:외부.md')
    memos = [meta('new-id')]
    expect(await store.opened('new-id', 'p:외부.md')).toEqual({ recent: ['new-id'], favorites: ['new-id'] })
  })

  it('즐겨찾기 상한에서 추가만 거절하고 해제는 허용한다', async () => {
    for (let n = 0; n < MAX_FAVORITE_MEMOS; n++) await store.favorite(String(n), true)
    await expect(store.favorite(String(MAX_FAVORITE_MEMOS), true)).rejects.toMatchObject({ code: 'too_large' })
    expect((await store.favorite('1', true)).favorites).toHaveLength(MAX_FAVORITE_MEMOS)
    expect((await store.favorite('1', false)).favorites).toHaveLength(MAX_FAVORITE_MEMOS - 1)
  })

  it.each(['{broken', '{"version":2}', '{"version":1,"recent":[123],"favorites":[]}'])('손상된 파일은 덮어쓰지 않는다: %s', async (raw) => {
    await writeFile(join(root, NAVIGATION_FILE), raw)
    await expect(store.get()).rejects.toMatchObject({ code: 'unreadable' })
    await expect(store.favorite('1', true)).rejects.toMatchObject({ code: 'unreadable' })
    expect(await readFile(join(root, NAVIGATION_FILE), 'utf8')).toBe(raw)
  })

  it('심볼릭 링크를 통해 다른 파일을 읽거나 고치지 않는다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memo-navigation-outside-'))
    try {
      const file = join(outside, 'private.json')
      await writeFile(file, '{"secret":"keep"}')
      await symlink(file, join(root, NAVIGATION_FILE))
      await expect(store.get()).rejects.toMatchObject({ code: 'bad_request' })
      await expect(store.opened('1')).rejects.toMatchObject({ code: 'bad_request' })
      expect(await readFile(file, 'utf8')).toBe('{"secret":"keep"}')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })

  it('잘못된 입력은 파일 작업 전에 거절한다', () => {
    for (const value of ['', null, '../\u0000', 1, 'x'.repeat(4097)]) expect(() => navigationId(value)).toThrow()
    expect(() => parseNavigationInput([])).toThrow()
    expect(() => parseNavigationInput({ id: false })).toThrow()
    expect(parseNavigationInput({ id: 'p:업무/회의.md' }).id).toBe('p:업무/회의.md')
  })
})
