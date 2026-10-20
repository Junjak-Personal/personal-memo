import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoStore } from './store'
import { MemoNavigationStore } from './navigation'
import { withStableMemoId } from './links'
import { parseMemo } from './file'
import { memoLinkHref } from '../../shared/utils/memo-links'

let root: string
let store: MemoStore
const input = (title: string, content = '') => ({ title, content, date: null, dateEnd: null, folder: '' })
const ID = '01M5D265Y7R61BQEFWDT6RA27E'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memo-links-'))
  store = new MemoStore(root)
  await store.init()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('영구 링크 대상', () => {
  it('기존 영구 ID는 파일에 쓰지 않고 메타만 반환한다', async () => {
    const memo = await store.create(input('기존', '본문'))
    const before = await readFile(join(root, memo.path))
    expect(await store.ensureLinkTarget(memo.id)).toMatchObject({ id: memo.id, path: memo.path })
    expect(await readFile(join(root, memo.path))).toEqual(before)
  })

  it('frontmatter 없는 외부 파일의 본문 바이트와 파일명을 유지하고 영구 ID만 추가한다', async () => {
    const raw = '# 제목\r\n\r\n각주[^1]  \r\n\r\n[^1]: 원문'
    await writeFile(join(root, '외부.md'), raw)
    const target = await store.ensureLinkTarget('p:외부.md')
    expect(target.id).not.toMatch(/^p:/)
    expect(target).toMatchObject({ path: '외부.md', created: null, updated: null })
    const next = await readFile(join(root, target.path), 'utf8')
    expect(next.endsWith(raw)).toBe(true)
    expect((await store.get(target.id)).content).toBe(raw)
    expect(await store.getRevisions(target.id)).toEqual([])
  })

  it('기존 YAML·주석·날짜·모르는 키와 본문을 정확히 유지한다', async () => {
    const raw = '---\r\n# 주석\r\ncustom: [a,b] # 그대로\r\ndate: 2026-10-21\r\npublic: true\r\ndone: yes\r\n---\r\n\r\n원문  \r\n\r\n'
    await writeFile(join(root, '외부.md'), raw)
    const target = await store.ensureLinkTarget('p:외부.md')
    const next = await readFile(join(root, '외부.md'), 'utf8')
    expect(next.replace(`id: ${target.id}\r\n`, '')).toBe(raw)
    expect(target).toMatchObject({ title: '외부', date: '2026-10-21', done: null, public: true })
  })

  it.each(['id: old # 주석\nx: x\n', '"id": old\nx: x\n', 'id:\nx: x\n', 'id: |\n  old\nx: x\n', 'id: [a,b]\nx: x\n'])('기존 잘못된 id 항목 %s도 다른 메타와 본문을 유지하며 바꾼다', yaml => {
    const raw = `---\n${yaml}---\n\n본문 원문`
    const next = withStableMemoId(raw, ID)
    const parsed = parseMemo(next)
    expect(parsed.ok && parsed.fields.id).toBe(ID)
    expect(parsed.body).toBe('본문 원문')
    expect(next).toContain('x: x\n')
    if (yaml.includes('# 주석')) expect(next).toContain('# 주석')
  })

  it('ID anchor 변경으로 모르는 alias의 의미를 바꾸지 않고 손상된 YAML도 거부한다', () => {
    const anchored = '---\nid: &same old\ncustom: *same\n---\n\n원문'
    expect(() => withStableMemoId(anchored, ID)).toThrowError(/안전하게/)
    expect(() => withStableMemoId('---\nwrong: [\n---\n\n원문', ID)).toThrowError(/frontmatter/)
  })

  it('외부 중복 ID 파일을 연결해도 원본 메모 ID를 빼앗지 않는다', async () => {
    const memo = await store.create(input('원본'))
    await writeFile(join(root, '중복.md'), await readFile(join(root, memo.path)))
    const tree = await store.tree()
    const duplicate = tree.memos.find(row => row.path === '중복.md')!
    expect(duplicate.id).toBe('p:중복.md')
    const promoted = await store.ensureLinkTarget(duplicate.id)
    expect(promoted.id).not.toBe(memo.id)
    expect((await store.get(memo.id)).path).toBe(memo.path)
  })

  it('루트 밖을 가리키는 링크와 읽을 수 없는 메모를 대상에 넣지 않는다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memo-links-outside-'))
    try {
      await writeFile(join(outside, '비밀.md'), '밖의 파일')
      await symlink(join(outside, '비밀.md'), join(root, '링크.md'))
      await expect(store.ensureLinkTarget('p:링크.md')).rejects.toMatchObject({ code: 'not_found' })
      await writeFile(join(root, '손상.md'), '---\nx: [\n---\n\n원문')
      await expect(store.ensureLinkTarget('p:손상.md')).rejects.toMatchObject({ code: 'unreadable' })
      expect(await readFile(join(outside, '비밀.md'), 'utf8')).toBe('밖의 파일')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })

  it('새 ID로 별표·기존 방문 순서를 이전하되 실제로 방문하지 않은 대상을 추가하지 않는다', async () => {
    const another = await store.create(input('다른 메모'))
    await writeFile(join(root, '외부.md'), '외부 본문')
    const navigation = new MemoNavigationStore(root, async () => (await store.tree()).memos)
    await navigation.favorite('p:외부.md', true)
    await navigation.opened(another.id)
    const target = await navigation.promoteTarget('p:외부.md', () => store.ensureLinkTarget('p:외부.md'))
    expect(await navigation.get()).toEqual({ favorites: [target.id], recent: [another.id] })
  })

  it('승격 중 도착한 다른 방문 기록이 아직 이전하지 않은 별표·방문 순서를 지우지 못한다', async () => {
    const another = await store.create(input('다른 메모'))
    await writeFile(join(root, '외부.md'), '외부 본문')
    const navigation = new MemoNavigationStore(root, async () => (await store.tree()).memos)
    await navigation.favorite('p:외부.md', true)
    await navigation.opened('p:외부.md')
    let complete!: () => void
    const hold = new Promise<void>(resolve => { complete = resolve })
    let promoted!: () => void
    const started = new Promise<void>(resolve => { promoted = resolve })
    const promotion = navigation.promoteTarget('p:외부.md', async () => {
      const target = await store.ensureLinkTarget('p:외부.md')
      promoted()
      await hold
      return target
    })
    await started
    const opening = navigation.opened(another.id)
    complete()
    const target = await promotion
    await opening
    expect(await navigation.get()).toEqual({ favorites: [target.id], recent: [another.id, target.id] })
  })
})

describe('활성 메모의 백링크', () => {
  it('중복 제목은 ID로 구분하고 제목/폴더 변경 뒤에도 같은 메모를 참조한다', async () => {
    let target = await store.create(input('같은 제목', '대상'))
    const sameTitle = await store.create(input('같은 제목', '다른 대상'))
    const source = await store.create(input('출처', `[대상](${memoLinkHref(target.id)})\n[중복](${memoLinkHref(target.id)})`))
    expect((await store.backlinks(target.id)).map(row => row.id)).toEqual([source.id])
    expect(await store.backlinks(sameTitle.id)).toEqual([])
    await store.createFolder('', '새 폴더')
    target = await store.update(target.id, { ...input('이름 변경', '대상'), baseVersion: target.version })
    await store.move(target.id, '새 폴더')
    expect((await store.backlinks(target.id)).map(row => row.id)).toEqual([source.id])
    expect((await store.backlinks(target.id))[0]).not.toHaveProperty('content')
  })

  it('휴지통/읽기 불가/자기 참조를 제외하고 삭제·되돌리기·편집을 다음 조회에 반영한다', async () => {
    let target = await store.create(input('대상'))
    target = await store.update(target.id, { ...input('대상', `[자기](${memoLinkHref(target.id)})`), baseVersion: target.version })
    let source = await store.create(input('출처', `[대상](${memoLinkHref(target.id)})`))
    expect((await store.backlinks(target.id)).map(row => row.id)).toEqual([source.id])
    const removed = await store.remove(source.id)
    expect(await store.backlinks(target.id)).toEqual([])
    await store.restore(removed.trashPath)
    source = await store.get(source.id)
    expect(await store.backlinks(target.id)).toHaveLength(1)
    source = await store.update(source.id, { ...input('출처', '참조 해제'), baseVersion: source.version })
    expect(await store.backlinks(target.id)).toEqual([])
    await writeFile(join(root, '손상.md'), `---\nbad: [\n---\n\n[참조](${memoLinkHref(target.id)})`)
    expect(await store.backlinks(target.id)).toEqual([])
    await store.remove(target.id)
    await expect(store.backlinks(target.id)).rejects.toMatchObject({ code: 'not_found' })
  })
})
