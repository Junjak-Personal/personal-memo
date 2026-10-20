import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ulid } from '../../shared/utils/ulid'
import { MemoHistory, HISTORY_GROUP_MS, HISTORY_LIMIT, HISTORY_RETENTION_MS } from './history'
import { MemoStore } from './store'

let root: string
let store: MemoStore
const input = (title = '처음', content = '이전 본문') => ({ title, content, date: null, dateEnd: null, tags: [] as string[] })
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memo-history-'))
  store = new MemoStore(root)
  await store.init()
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const bucket = (id: string) => join(root, '.history', createHash('sha256').update(id).digest('hex'))

describe('수정 이력 저장과 복원', () => {
  it('첫 수정 전 내용을 보관하고 연속 자동저장을 묶으며 이름 변경 뒤에도 같은 ID로 찾는다', async () => {
    let memo = await store.create({ ...input(), folder: '' })
    expect(await store.getRevisions(memo.id)).toEqual([])
    const originalId = memo.id
    memo = await store.update(memo.id, { ...input('바뀐 제목', '다음 본문'), baseVersion: memo.version })
    memo = await store.update(memo.id, { ...input('또 바뀜', '더 다음 본문'), baseVersion: memo.version })
    expect(memo.id).toBe(originalId)
    const list = await store.getRevisions(memo.id)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ title: '처음', contentLength: '이전 본문\n'.length })
    expect(list[0]).not.toHaveProperty('content')
    expect(await store.getRevision(memo.id, list[0]!.id)).toMatchObject({ title: '처음', content: '이전 본문\n' })
    const tree = await store.tree()
    expect(tree.memos).toHaveLength(1)
    expect(tree.folders).toEqual([])
    expect(await store.search('이전 본문')).toEqual([])
  })

  it('복원 직전 상태를 강제 보관하고 현재 ID·폴더·생성시각·완료·공개·모르는 frontmatter를 유지한다', async () => {
    await store.createFolder('', '옮긴 곳')
    let memo = await store.create({ ...input(), folder: '', done: false })
    const created = memo.created
    const firstRaw = await readFile(join(root, memo.path), 'utf8')
    await writeFile(join(root, memo.path), firstRaw.replace('---\n', '---\ncustom: 유지\n'))
    memo = await store.get(memo.id)
    memo = await store.update(memo.id, { ...input('최신', '새 내용'), date: '2026-10-21', tags: ['새 태그'], baseVersion: memo.version })
    const initial = (await store.getRevisions(memo.id))[0]!
    await store.setDone(memo.id, true)
    await store.setPublic(memo.id, true)
    await store.move(memo.id, '옮긴 곳')
    memo = await store.get(memo.id)
    const restored = await store.restoreRevision(memo.id, initial.id, memo.version)
    expect(restored).toMatchObject({ id: memo.id, folder: '옮긴 곳', created, title: '처음', content: '이전 본문\n', date: null, tags: [], done: true, public: true })
    expect(await readFile(join(root, restored.path), 'utf8')).toContain('custom: 유지')
    const list = await store.getRevisions(memo.id)
    expect(list).toHaveLength(2)
    const preRestore = list.find((r) => r.title === '최신')!
    expect(await store.getRevision(memo.id, preRestore.id)).toMatchObject({ content: '새 내용\n', date: '2026-10-21', tags: ['새 태그'] })
    const undo = await store.restoreRevision(memo.id, preRestore.id, restored.version)
    expect(undo).toMatchObject({ title: '최신', content: '새 내용\n', done: true, public: true })
  })

  it('다른 기기의 수정과 잘못된 이력은 파일·이력을 바꾸지 않고 거절한다', async () => {
    let memo = await store.create({ ...input(), folder: '' })
    memo = await store.update(memo.id, { ...input('최신'), baseVersion: memo.version })
    const revision = (await store.getRevisions(memo.id))[0]!
    const newer = await store.update(memo.id, { ...input('다른 기기'), baseVersion: memo.version })
    await expect(store.restoreRevision(memo.id, revision.id, memo.version)).rejects.toMatchObject({ code: 'conflict', extra: { version: newer.version } })
    await expect(store.restoreRevision(memo.id, '../outside', newer.version)).rejects.toMatchObject({ code: 'bad_request' })
    expect(await store.get(memo.id)).toMatchObject({ title: '다른 기기', version: newer.version })
    expect(await store.getRevisions(memo.id)).toHaveLength(1)
  })

  it('경로 ID 첫 저장은 새 영구 ID 아래에 원래 본문을 보관하고 삭제된 메모의 이력은 읽지 못한다', async () => {
    await writeFile(join(root, '외부.md'), '외부 본문\n')
    const pathMemo = (await store.tree()).memos[0]!
    const memo = await store.get(pathMemo.id)
    const saved = await store.update(memo.id, { ...input('저장', '변경'), baseVersion: memo.version })
    expect(saved.id).not.toBe(memo.id)
    const list = await store.getRevisions(saved.id)
    expect(list).toHaveLength(1)
    expect(await store.getRevision(saved.id, list[0]!.id)).toMatchObject({ content: '외부 본문\n' })
    await store.remove(saved.id)
    await expect(store.getRevisions(saved.id)).rejects.toMatchObject({ code: 'not_found' })
    await expect(store.getRevision(saved.id, list[0]!.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('휴지통 되돌리기는 이력을 유지하고 영구 삭제는 해당 메모의 보관 이미지까지 지운다', async () => {
    let deleted = await store.create({ ...input('삭제 대상'), folder: '' })
    const image = await store.saveImage(deleted.id, PNG, PNG)
    deleted = await store.update(deleted.id, { ...input('삭제 대상', `![사진](${image.src})`), baseVersion: deleted.version })
    const initial = (await store.getRevisions(deleted.id))[0]!
    deleted = await store.restoreRevision(deleted.id, initial.id, deleted.version)
    let live = await store.create({ ...input('살아 있는 메모'), folder: '' })
    live = await store.update(live.id, { ...input('살아 있는 메모', '다음 내용'), baseVersion: live.version })
    const trash = await store.remove(deleted.id)
    await store.restore(trash.trashPath)
    expect(await store.getRevisions(deleted.id)).toHaveLength(2)
    await store.remove(deleted.id)
    await store.emptyTrash()
    await expect(readdir(bucket(deleted.id))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await store.getRevisions(live.id)).toHaveLength(1)
  })

  it('오래된 휴지통 자동 삭제도 그 이력만 지우고 아직 휴지통에 남은 메모의 이력은 유지한다', async () => {
    let expired = await store.create({ ...input('오래된 메모'), folder: '' })
    expired = await store.update(expired.id, { ...input('오래된 메모', '수정'), baseVersion: expired.version })
    let recent = await store.create({ ...input('최근 메모'), folder: '' })
    recent = await store.update(recent.id, { ...input('최근 메모', '수정'), baseVersion: recent.version })
    const expiredTrash = await store.remove(expired.id)
    const recentTrash = await store.remove(recent.id)
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    await utimes(join(root, '.trash', expiredTrash.trashPath), old, old)
    expect(await store.purgeTrash()).toMatchObject({ memos: 1 })
    await expect(readdir(bucket(expired.id))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(bucket(recent.id))).toHaveLength(1)
    await store.restore(recentTrash.trashPath)
    expect(await store.getRevisions(recent.id)).toHaveLength(1)
  })

  it('같은 ID의 외부 복사본이 살아 있으면 휴지통 원본 삭제가 공유 이력을 지우지 않는다', async () => {
    let memo = await store.create({ ...input('원본'), folder: '' })
    memo = await store.update(memo.id, { ...input('원본', '최신'), baseVersion: memo.version })
    await writeFile(join(root, '복사본.md'), await readFile(join(root, memo.path), 'utf8'))
    await store.remove(memo.id)
    await store.emptyTrash()
    expect(await store.getRevisions(memo.id)).toHaveLength(1)
    expect((await store.get(memo.id)).path).toBe('복사본.md')
  })

  it('별도 보관한 이미지·원본은 폴더 이동·삭제·미참조 정리 뒤에도 새 이름으로 복원한다', async () => {
    await store.createFolder('', '예전')
    await store.createFolder('', '현재')
    let memo = await store.create({ ...input(), folder: '예전' })
    const image = await store.saveImage(memo.id, PNG, PNG)
    memo = await store.update(memo.id, { ...input('이미지', `![사진](${image.src})`), baseVersion: memo.version })
    // 복원 직전 강제 보관 경로를 써서 첫5분 내 이미지 버전도 선택 가능하게 만든다.
    const first = (await store.getRevisions(memo.id))[0]!
    memo = await store.restoreRevision(memo.id, first.id, memo.version)
    const withImage = (await store.getRevisions(memo.id)).find((r) => r.title === '이미지')!
    await store.move(memo.id, '현재')
    await store.emptyTrash() // 현재 본문이 쓰지 않는 원래 이미지와 원본을 정리한다.
    await store.deleteFolder('예전')
    memo = await store.get(memo.id)
    const restored = await store.restoreRevision(memo.id, withImage.id, memo.version)
    expect(restored.content).toMatch(/!\[사진\]\(assets\/[0-9A-Z]+\.png\)/)
    const currentFiles = await readdir(join(root, '현재/assets'))
    expect(currentFiles).toHaveLength(2)
    expect(currentFiles.some((name) => name.includes('.orig.'))).toBe(true)
    for (const name of currentFiles) expect(await readFile(join(root, '현재/assets', name))).toEqual(PNG)
  })

  it('손상된 이력은 안내 오류로 처리하고 다음 저장이 현재 파일을 덮지 않는다', async () => {
    let memo = await store.create({ ...input(), folder: '' })
    memo = await store.update(memo.id, { ...input('최신'), baseVersion: memo.version })
    const revision = (await store.getRevisions(memo.id))[0]!
    await writeFile(join(bucket(memo.id), revision.id, 'revision.json'), '{broken')
    await expect(store.getRevision(memo.id, revision.id)).rejects.toMatchObject({ code: 'unreadable' })
    await expect(store.update(memo.id, { ...input('덮지 않음'), baseVersion: memo.version })).rejects.toMatchObject({ code: 'unreadable' })
    expect((await store.get(memo.id)).title).toBe('최신')
  })

  it('이력을 쓸 수 없으면 원래 파일을 먼저 덮지 않는다', async () => {
    const memo = await store.create({ ...input(), folder: '' })
    await writeFile(join(root, '.history'), '폴더가 아닌 파일')
    await expect(store.update(memo.id, { ...input('수정하면 안 됨'), baseVersion: memo.version })).rejects.toBeDefined()
    expect((await store.get(memo.id)).version).toBe(memo.version)
  })

  it('이력 경로의 심볼릭 링크 탈출은 읽기·저장 전에 거부한다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memo-history-outside-'))
    try {
      await symlink(outside, join(root, '.history'))
      const memo = await store.create({ ...input(), folder: '' })
      await expect(store.update(memo.id, { ...input('수정'), baseVersion: memo.version })).rejects.toMatchObject({ code: 'bad_request' })
      expect(await readdir(outside)).toEqual([])
      expect((await store.get(memo.id)).title).toBe('처음')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })

  it('본문을 이미지로 위장해 다른 메모 파일을 이력에 복사하지 않는다', async () => {
    let memo = await store.create({ ...input('첫째', '![사진](비밀.md)'), folder: '' })
    await store.create({ ...input('비밀', '보관하면 안 됨'), folder: '' })
    memo = await store.update(memo.id, { ...input('수정'), baseVersion: memo.version })
    const revision = (await store.getRevisions(memo.id))[0]!
    expect(await readdir(join(bucket(memo.id), revision.id))).toEqual(['revision.json'])
  })

  it('중단된 숨김 staging 폴더는 무시하고 완성된 revision.json과 이미지만 원자적으로 게시한다', async () => {
    const memo = await store.create({ ...input('사진'), folder: '' })
    const folder = bucket(memo.id)
    const leftover = join(folder, '.pending-crash')
    await mkdir(leftover, { recursive: true })
    await writeFile(join(leftover, 'revision.json'), '{partial')
    await writeFile(join(leftover, 'incomplete.png'), PNG.subarray(0, 4))
    expect(await store.getRevisions(memo.id)).toEqual([])
    await store.update(memo.id, { ...input('게시 완료'), baseVersion: memo.version })
    const revisions = await store.getRevisions(memo.id)
    expect(revisions).toHaveLength(1)
    const record = JSON.parse(await readFile(join(folder, revisions[0]!.id, 'revision.json'), 'utf8'))
    expect(record.revision.id).toBe(revisions[0]!.id)
    expect(await store.getRevision(memo.id, revisions[0]!.id)).toMatchObject({ title: '사진' })
    expect((await readdir(folder)).filter((name) => name.startsWith('.pending-'))).toEqual(['.pending-crash'])
  })

  it('이미지 보관 실패의 staging은 지우고 원본 메모는 유지한다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memo-history-image-'))
    try {
      await mkdir(join(root, 'assets'))
      await writeFile(join(outside, 'image.png'), PNG)
      await symlink(join(outside, 'image.png'), join(root, 'assets/image.png'))
      const memo = await store.create({ ...input('사진', '![사진](assets/image.png)'), folder: '' })
      await expect(store.update(memo.id, { ...input('실패'), baseVersion: memo.version })).rejects.toMatchObject({ code: 'bad_request' })
      expect(await readdir(bucket(memo.id))).toEqual([])
      expect((await store.get(memo.id)).version).toBe(memo.version)
    } finally { await rm(outside, { recursive: true, force: true }) }
  })
})

describe('자동저장 묶음과 보관 상한', () => {
  it('5분 경계·중복 제거·50개 상한·30일 만료를 적용하고 오래된 파일도 정리한다', async () => {
    let clock = Date.parse('2026-10-01T00:00:00Z')
    const history = new MemoHistory(root, () => clock)
    await history.capture('memo', input(), '')
    await history.capture('memo', input('연속'), '')
    expect(await history.list('memo')).toHaveLength(1)
    clock += HISTORY_GROUP_MS
    await history.capture('memo', input('경계'), '')
    expect(await history.list('memo')).toHaveLength(2)
    clock += HISTORY_GROUP_MS
    await history.capture('memo', input('경계'), '')
    expect(await history.list('memo')).toHaveLength(2)
    for (let n = 0; n < HISTORY_LIMIT; n++) {
      clock += HISTORY_GROUP_MS
      await history.capture('memo', input(String(n)), '')
    }
    expect(await history.list('memo')).toHaveLength(HISTORY_LIMIT)
    expect(await readdir(bucket('memo'))).toHaveLength(HISTORY_LIMIT)
    const oldest = (await history.list('memo')).at(-1)!
    clock += HISTORY_RETENTION_MS + 1
    await expect(history.get('memo', oldest.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await history.list('memo')).toEqual([])
    expect(await readdir(bucket('memo'))).toHaveLength(0)
    await history.capture('memo', input('새 시작'), '')
    expect(await readdir(bucket('memo'))).toHaveLength(1)
  })

  it('기존 정리 경로는 다시 열지 않은 메모의 만료 이력도 지우며 최근·알 수 없는 파일은 유지한다', async () => {
    const old = await store.create({ ...input('열지 않는 메모'), folder: '' })
    const fresh = await store.create({ ...input('최근 메모'), folder: '' })
    const oldHistory = new MemoHistory(root, () => Date.now() - HISTORY_RETENTION_MS - 1000)
    const freshHistory = new MemoHistory(root)
    await oldHistory.capture(old.id, input('오래된 버전'), '')
    await freshHistory.capture(fresh.id, input('최근 버전'), '')
    const oldRevision = (await readdir(bucket(old.id)))[0]!
    const freshRevision = (await readdir(bucket(fresh.id)))[0]!
    const unknown = join(bucket(old.id), ulid())
    await mkdir(unknown)
    await writeFile(join(unknown, 'revision.json'), '알 수 없는 파일')
    await writeFile(join(bucket(old.id), 'notes.txt'), '사용자가 둔 파일')
    await mkdir(join(bucket(old.id), '.pending-crash'))
    await writeFile(join(root, '.history/readme.txt'), '그대로 유지')
    expect(await store.purgeHistory()).toBe(1)
    await expect(readdir(join(bucket(old.id), oldRevision))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(unknown, 'revision.json'), 'utf8')).toBe('알 수 없는 파일')
    expect(await readFile(join(bucket(old.id), 'notes.txt'), 'utf8')).toBe('사용자가 둔 파일')
    expect(await readFile(join(root, '.history/readme.txt'), 'utf8')).toBe('그대로 유지')
    expect((await readdir(join(bucket(fresh.id), freshRevision))).includes('revision.json')).toBe(true)
    expect((await store.get(old.id)).title).toBe('열지 않는 메모')
    expect(await store.purgeHistory()).toBe(0)
  })

  it('전체 정리도 심볼릭 링크를 따라 저장소 밖의 파일을 지우지 않는다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memo-history-purge-outside-'))
    try {
      const historyRoot = join(root, '.history')
      await mkdir(historyRoot)
      await writeFile(join(outside, 'keep.txt'), '삭제 금지')
      await symlink(outside, join(historyRoot, 'a'.repeat(64)))
      expect(await store.purgeHistory()).toBe(0)
      expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('삭제 금지')
      await rm(historyRoot, { recursive: true })
      await symlink(outside, historyRoot)
      await expect(store.purgeHistory()).rejects.toMatchObject({ code: 'bad_request' })
      expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('삭제 금지')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })

  it('30일 지난 자체 staging만 회수하고 최근·다른 이름·파일·심볼릭 링크는 보존한다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memo-history-staging-outside-'))
    try {
      const folder = bucket('staging-test')
      await mkdir(folder, { recursive: true })
      const ownedName = () => `.pending-${ulid()}-${randomUUID()}`
      const expired = join(folder, ownedName())
      const recent = join(folder, ownedName())
      const unknown = join(folder, '.pending-crash')
      const regularFile = join(folder, ownedName())
      const linked = join(folder, ownedName())
      for (const directory of [expired, recent, unknown]) {
        await mkdir(directory)
        await writeFile(join(directory, 'private.png'), PNG)
      }
      await writeFile(regularFile, '폴더가 아닌 것은 그대로 둔다')
      await writeFile(join(outside, 'private.png'), PNG)
      await symlink(outside, linked)
      const old = new Date(Date.now() - HISTORY_RETENTION_MS - 1000)
      for (const path of [expired, unknown, regularFile, outside]) await utimes(path, old, old)
      expect(await store.purgeHistory()).toBe(1)
      await expect(readdir(expired)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(recent, 'private.png'))).toEqual(PNG)
      expect(await readFile(join(unknown, 'private.png'))).toEqual(PNG)
      expect(await readFile(regularFile, 'utf8')).toBe('폴더가 아닌 것은 그대로 둔다')
      expect(await readFile(join(linked, 'private.png'))).toEqual(PNG)
      expect(await readFile(join(outside, 'private.png'))).toEqual(PNG)
      expect(await store.purgeHistory()).toBe(0)
    } finally { await rm(outside, { recursive: true, force: true }) }
  })
})

it('HTML 표 이미지를 이력에 보관하고 GC 뒤 복원하며 코드 예시는 바꾸지 않는다', async () => {
  let memo = await store.create({ ...input('표 사진', ''), folder: '' })
  const image = await store.saveImage(memo.id, PNG, PNG)
  const content = `<table><tr><td><img src="${image.src}"></td></tr></table>\n\n\`<img src="${image.src}">\``
  memo = await store.update(memo.id, { ...input('표 사진', content), baseVersion: memo.version })
  const history = new MemoHistory(root)
  await history.capture(memo.id, memo, '', true)
  const revision = (await store.getRevisions(memo.id)).find(entry => entry.title === '표 사진' && entry.contentLength === memo.content.length)!
  memo = await store.update(memo.id, { ...input('표 사진', '이미지 제거'), baseVersion: memo.version })
  const trash = await store.create({ ...input('삭제'), folder: '' })
  await store.remove(trash.id)
  await store.emptyTrash()
  await expect(readFile(join(root, image.src))).rejects.toMatchObject({ code: 'ENOENT' })
  const restored = await store.restoreRevision(memo.id, revision.id, memo.version)
  const src = /<img src="([^"]+)"/.exec(restored.content)![1]!
  expect(src).not.toBe(image.src)
  expect(await readFile(join(root, src))).toEqual(PNG)
  expect(await readFile(join(root, src.replace('.png', '.orig.png')))).toEqual(PNG)
  expect(restored.content).toContain(`\`<img src="${image.src}">\``)
})
