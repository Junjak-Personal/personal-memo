import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MemoError } from './errors'
import { MemoStore } from './store'

let root: string
let store: MemoStore

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memo-store-'))
  store = new MemoStore(join(root, 'memos'))
  await mkdir(join(root, 'memos'))
  await store.init()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const memos = (rel = '') => join(root, 'memos', rel)

async function rejects(p: Promise<unknown>, code: MemoError['code']) {
  await expect(p).rejects.toMatchObject({ code })
}

/** 외부 편집 흉내 — mtime 을 확실히 바꿔 재스캔이 알아채게 한다 */
async function externalWrite(rel: string, text: string) {
  await writeFile(memos(rel), text)
  const later = new Date(Date.now() + 5000)
  await utimes(memos(rel), later, later)
}

function input(title: string, content = '본문', extra: Partial<{ date: string | null; dateEnd: string | null }> = {}) {
  return { title, content, date: null, dateEnd: null, ...extra }
}

describe('경로 검사', () => {
  it('루트 밖으로 나가는 폴더를 거부한다', async () => {
    await rejects(store.create({ ...input('a'), folder: '../밖' }), 'bad_request')
    await rejects(store.createFolder('', '..'), 'bad_request')
    await rejects(store.createFolder('', 'a/b'), 'bad_request')
  })

  it('예약 이름과 숨김 폴더를 거부한다', async () => {
    await rejects(store.createFolder('', 'assets'), 'bad_request')
    await rejects(store.createFolder('', '.trash'), 'bad_request')
    await rejects(store.createFolder('', '.숨김'), 'bad_request')
  })

  it('루트 밖을 가리키는 심볼릭 링크를 따라가지 않는다', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'memo-outside-'))
    await symlink(outside, memos('링크'))
    await rejects(store.create({ ...input('탈출'), folder: '링크' }), 'bad_request')
    expect(await readdir(outside)).toEqual([])
    await rm(outside, { recursive: true, force: true })
  })

  it('이미지 경로로 메모 원문이나 휴지통을 읽지 못한다', async () => {
    const memo = await store.create({ ...input('비밀'), folder: '' })
    await rejects(store.imageFile(memo.path), 'not_found')
    await rejects(store.imageFile('.trash/assets/x.png'), 'not_found')
    await rejects(store.imageFile('../assets/x.png'), 'not_found')
  })
})

describe('생성·수정', () => {
  it('제목으로 파일 이름을 짓고, 겹치면 (2) 를 붙인다', async () => {
    const a = await store.create({ ...input('회의록'), folder: '' })
    const b = await store.create({ ...input('회의록'), folder: '' })
    expect(a.path).toBe('회의록.md')
    expect(b.path).toBe('회의록 (2).md')
    expect(a.id).not.toBe(b.id)
  })

  it('파일 이름에 못 쓰는 문자를 치환한다', async () => {
    const m = await store.create({ ...input('a/b\\c'), folder: '' })
    expect(m.path).toBe('a b c.md')
    expect(m.title).toBe('a/b\\c')
  })

  it('에이전트의 병합 HTML 표는 저장·재조회·다시 저장에서 그대로 유지한다', async () => {
    const html = '<table><tr><th colspan="2">오늘 요약</th></tr><tr><td rowspan="2">개발</td><td>수정</td></tr><tr><td>검토</td></tr></table>'
    const memo = await store.create({ ...input('합성 표', html), folder: '' })
    const loaded = await store.get(memo.id)
    expect(loaded.content.trim()).toBe(html)
    const edited = `${loaded.content.trim()}\n\n관련 없는 문단 수정`
    await store.update(loaded.id, { ...input('합성 표', edited), baseVersion: loaded.version })
    const reloaded = await store.get(loaded.id)
    expect(reloaded.content.trim()).toBe(edited)
    expect(await readFile(memos(reloaded.path), 'utf8')).toContain(html)
  })

  it('frontmatter 의 모르는 키와 주석을 지우지 않는다', async () => {
    await externalWrite(
      '외부.md',
      '---\n# 주석\ntitle: 외부\ntags: [a, b]\naliases:\n  - 별칭\n---\n\n본문\n',
    )
    const opened = (await store.tree()).memos.find((m) => m.path === '외부.md')!
    const memo = await store.get(opened.id)
    await store.update(memo.id, { ...input('외부', '바뀐 본문'), baseVersion: memo.version })
    const raw = await readFile(memos('외부.md'), 'utf8')
    expect(raw).toContain('# 주석')
    expect(raw).toContain('tags: [a, b]') // 사람이 쓴 모양 그대로
    expect(raw).toContain('- 별칭')
    expect(raw).toContain('바뀐 본문')
  })

  it('기준 버전이 다르면 409 와 현재 버전을 준다 — vim 으로 고친 경우도 같다', async () => {
    const memo = await store.create({ ...input('충돌'), folder: '' })
    const raw = await readFile(memos(memo.path), 'utf8')
    await externalWrite(memo.path, raw.replace('본문', 'vim 에서 고침'))
    const err = await store.update(memo.id, { ...input('충돌', '앱에서 고침'), baseVersion: memo.version }).catch((e: MemoError) => e)
    expect(err).toMatchObject({ code: 'conflict' })
    expect((err as MemoError).extra.version).toMatch(/^[0-9a-f]{32}$/)
    expect(await readFile(memos(memo.path), 'utf8')).toContain('vim 에서 고침')
  })

  it('제목을 바꾸면 파일 이름이 따라가고 id 는 그대로다', async () => {
    const memo = await store.create({ ...input('처음'), folder: '' })
    const next = await store.update(memo.id, { ...input('나중'), baseVersion: memo.version })
    expect(next.path).toBe('나중.md')
    expect(next.id).toBe(memo.id)
    expect((await readdir(memos())).filter((n) => n.endsWith('.md'))).toEqual(['나중.md'])
  })

  it('밖에서 지은 파일 이름은 제목이 그대로면 바꾸지 않는다', async () => {
    await externalWrite('meeting.md', '---\ntitle: 회의\n---\n\n본문\n')
    const meta = (await store.tree()).memos[0]!
    const memo = await store.get(meta.id)
    const next = await store.update(memo.id, { ...input('회의', '고침'), baseVersion: memo.version })
    expect(next.path).toBe('meeting.md')
  })

  it('id 없는 외부 파일은 경로 id 로 열리고, 첫 저장에서 id·created 를 받는다', async () => {
    await externalWrite('맨몸.md', '그냥 본문\n')
    const meta = (await store.tree()).memos[0]!
    expect(meta.id).toBe('p:맨몸.md')
    expect(meta.created).toBeNull()
    const memo = await store.get(meta.id)
    const saved = await store.update(memo.id, { ...input('맨몸', '그냥 본문'), baseVersion: memo.version })
    expect(saved.id).toMatch(/^[0-9A-Z]{26}$/)
    expect(saved.created).toMatch(/\+09:00$/)
  })

  it('같은 id 를 가진 복사본은 경로 id 로 갈리고, 저장하면 새 id 를 받는다', async () => {
    const memo = await store.create({ ...input('원본'), folder: '' })
    await externalWrite('원본 사본.md', await readFile(memos(memo.path), 'utf8'))
    const tree = await store.tree()
    const copy = tree.memos.find((m) => m.path === '원본 사본.md')!
    expect(copy.id).toBe('p:원본 사본.md')
    const opened = await store.get(copy.id)
    const saved = await store.update(copy.id, { ...input('원본', '사본'), baseVersion: opened.version })
    expect(saved.id).not.toBe(memo.id)
  })

  it('처음 스캔에서 같은 id 가 둘이면 mtime 이 오래된 파일이 id 를 갖는다', async () => {
    const id = '01JB7W0000000000000000000A'
    await writeFile(memos('나중 사본.md'), `---\nid: ${id}\ntitle: 사본\n---\n\n본문\n`)
    await writeFile(memos('원본.md'), `---\nid: ${id}\ntitle: 원본\n---\n\n본문\n`)
    const old = new Date('2026-01-01T00:00:00Z')
    await utimes(memos('원본.md'), old, old)
    const fresh = new MemoStore(memos())
    const { memos: list } = await fresh.tree()
    expect(list.find((m) => m.path === '원본.md')!.id).toBe(id)
    expect(list.find((m) => m.path === '나중 사본.md')!.id).toBe('p:나중 사본.md')
  })

  it('frontmatter 를 읽지 못하는 파일은 저장하지 않는다', async () => {
    await externalWrite('깨짐.md', '---\ntitle: [닫히지 않음\n---\n\n본문\n')
    const meta = (await store.tree()).memos[0]!
    expect(meta.unreadable).toBe(true)
    const memo = await store.get(meta.id)
    await rejects(store.update(meta.id, { ...input('깨짐'), baseVersion: memo.version }), 'unreadable')
  })

  it('없는 폴더에는 만들지 않는다', async () => {
    await rejects(store.create({ ...input('a'), folder: '없음' }), 'not_found')
  })
})

describe('재스캔', () => {
  it('밖에서 추가·수정·삭제한 파일이 다음 요청에 보인다', async () => {
    const memo = await store.create({ ...input('하나'), folder: '' })
    await externalWrite('둘.md', '---\ntitle: 둘\n---\n\n찾을단어\n')
    expect((await store.tree()).memos.map((m) => m.title).sort()).toEqual(['둘', '하나'])
    expect((await store.search('찾을단어')).map((h) => h.title)).toEqual(['둘'])
    await rm(memos(memo.path))
    expect((await store.tree()).memos.map((m) => m.title)).toEqual(['둘'])
  })

  it('id 가 있으면 밖에서 옮겨도 같은 메모로 본다', async () => {
    const memo = await store.create({ ...input('이사'), folder: '' })
    await mkdir(memos('새집'))
    const { rename } = await import('node:fs/promises')
    await rename(memos(memo.path), memos('새집/이사.md'))
    const moved = await store.get(memo.id)
    expect(moved.path).toBe('새집/이사.md')
  })
})

describe('이동·휴지통·이미지', () => {
  it('메모를 옮기면 같은 폴더 assets 의 이미지가 따라가고, 남이 쓰는 이미지는 복사한다', async () => {
    await mkdir(memos('가'))
    await mkdir(memos('나'))
    const a = await store.create({ ...input('A'), folder: '가' })
    const { src: own } = await store.saveImage(a.id, PNG)
    const { src: shared } = await store.saveImage(a.id, PNG)
    const fresh = await store.get(a.id)
    await store.update(a.id, { ...input('A', `![](${own})\n\n![](${shared})`), baseVersion: fresh.version })
    await store.create({ ...input('B', `![](${shared})`), folder: '가' })

    await store.move(a.id, '나')
    const moved = await store.get(a.id)
    expect(moved.path).toBe('나/A.md')
    expect(await readdir(memos('나/assets'))).toEqual(expect.arrayContaining([own.slice(7), shared.slice(7)]))
    expect(await readdir(memos('가/assets'))).toEqual([shared.slice(7)])
  })

  it('삭제 → 휴지통 → 복원하면 이미지까지 그대로다', async () => {
    const memo = await store.create({ ...input('지울것'), folder: '' })
    const { src } = await store.saveImage(memo.id, PNG)
    const fresh = await store.get(memo.id)
    await store.update(memo.id, { ...input('지울것', `![](${src})`), baseVersion: fresh.version })

    await store.remove(memo.id)
    expect((await store.tree()).memos).toEqual([])
    const trash = await store.trashList()
    expect(trash.map((t) => t.path)).toEqual(['지울것.md'])

    const restored = await store.restore('지울것.md')
    expect(restored.id).toBe(memo.id)
    expect((await store.imageFile(src)).type).toBe('image/png')
  })

  it('같은 이름이 휴지통에 이미 있으면 (2) 경로를 돌려주고, 그 경로로 복원된다', async () => {
    const first = await store.create({ ...input('같은이름'), folder: '' })
    await store.remove(first.id)
    const second = await store.create({ ...input('같은이름', '두 번째'), folder: '' })
    const { trashPath } = await store.remove(second.id)
    expect(trashPath).toBe('같은이름 (2).md')
    const restored = await store.restore(trashPath)
    expect(restored.id).toBe(second.id)
  })

  it('원본을 같이 올리면 `.orig` 로 옆에 두고, 원본 주소는 원본을 — 없으면 화면 이미지를 준다', async () => {
    const memo = await store.create({ ...input('사진'), folder: '' })
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
    const withOriginal = await store.saveImage(memo.id, PNG, JPEG)
    expect(withOriginal.original).toBe(true)
    const stem = withOriginal.src.slice(0, -'.png'.length)
    expect((await readdir(memos('assets'))).sort()).toEqual([`${stem.slice(7)}.orig.jpg`, `${stem.slice(7)}.png`].sort())
    const original = await store.originalImageFile(withOriginal.src)
    // 주소는 화면 이미지(.png)지만 내려받는 이름은 원본의 확장자 — 내용과 이름이 어긋나지 않게
    expect(original).toMatchObject({ stored: true, type: 'image/jpeg', name: `${stem.slice(7)}.jpg` })

    const plain = await store.saveImage(memo.id, PNG)
    expect(plain.original).toBe(false)
    const plainStem = plain.src.slice(7, -'.png'.length)
    expect(await store.originalImageFile(plain.src)).toMatchObject({ stored: false, type: 'image/png', name: `${plainStem}.png` })
  })

  it('원본이 이미지가 아니거나 30MB 를 넘으면 거부한다', async () => {
    const memo = await store.create({ ...input('사진'), folder: '' })
    await rejects(store.saveImage(memo.id, PNG, new TextEncoder().encode('heic?')), 'unsupported_type')
    await rejects(store.saveImage(memo.id, PNG, new Uint8Array(30 * 1024 * 1024 + 1)), 'too_large')
  })

  it('정리할 때 원본은 그 화면 이미지가 참조되는 동안 남는다', async () => {
    const keep = await store.create({ ...input('남김'), folder: '' })
    const gone = await store.create({ ...input('버림'), folder: '' })
    const { src: kept } = await store.saveImage(keep.id, PNG, PNG)
    const { src: dropped } = await store.saveImage(gone.id, PNG, PNG)
    await store.update(keep.id, { ...input('남김', `![](${kept})`), baseVersion: (await store.get(keep.id)).version })
    await store.update(gone.id, { ...input('버림', `![](${dropped})`), baseVersion: (await store.get(gone.id)).version })
    await store.remove(gone.id)
    expect(await store.emptyTrash()).toEqual({ memos: 1, images: 2 })
    const left = (await readdir(memos('assets'))).sort()
    expect(left).toEqual([`${kept.slice(7, -4)}.orig.png`, kept.slice(7)].sort())
  })

  it('메모를 옮기면 원본도 따라간다 — 다른 메모도 쓰는 이미지면 둘 다 복사', async () => {
    await store.createFolder('', '새곳')
    const memo = await store.create({ ...input('이사'), folder: '' })
    const other = await store.create({ ...input('같이 씀'), folder: '' })
    const { src: own } = await store.saveImage(memo.id, PNG, PNG)
    const { src: shared } = await store.saveImage(memo.id, PNG, PNG)
    await store.update(memo.id, { ...input('이사', `![](${own})\n\n![](${shared})`), baseVersion: (await store.get(memo.id)).version })
    await store.update(other.id, { ...input('같이 씀', `![](${shared})`), baseVersion: (await store.get(other.id)).version })
    await store.move(memo.id, '새곳')
    const name = (src: string) => src.slice(7)
    const orig = (src: string) => `${src.slice(7, -4)}.orig.png`
    expect((await readdir(memos('새곳/assets'))).sort()).toEqual([name(own), orig(own), name(shared), orig(shared)].sort())
    // 옮긴 것은 원래 자리에서 사라지고, 같이 쓰는 것은 남는다
    expect((await readdir(memos('assets'))).sort()).toEqual([name(shared), orig(shared)].sort())
  })

  it('휴지통 비우기는 아무도 안 쓰는 이미지만 지운다', async () => {
    const keep = await store.create({ ...input('남김'), folder: '' })
    const gone = await store.create({ ...input('버림'), folder: '' })
    const { src: kept } = await store.saveImage(keep.id, PNG)
    const { src: dropped } = await store.saveImage(gone.id, PNG)
    await store.update(keep.id, { ...input('남김', `![](${kept})`), baseVersion: (await store.get(keep.id)).version })
    await store.update(gone.id, { ...input('버림', `![](${dropped})`), baseVersion: (await store.get(gone.id)).version })

    await store.remove(gone.id)
    expect(await store.emptyTrash()).toEqual({ memos: 1, images: 1 })
    expect(await readdir(memos('assets'))).toEqual([kept.slice(7)])
  })

  it('30일이 지난 휴지통 메모만 자동으로 지우고, 그 메모만 쓰던 이미지와 빈 폴더도 정리한다', async () => {
    await store.createFolder('', '일')
    const old = await store.create({ ...input('오래됨'), folder: '일' })
    const recent = await store.create({ ...input('최근'), folder: '' })
    const { src } = await store.saveImage(old.id, PNG)
    await store.update(old.id, { ...input('오래됨', `![](${src})`), baseVersion: (await store.get(old.id)).version })
    const { trashPath: oldPath } = await store.remove(old.id)
    await store.remove(recent.id)

    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const aged = new Date(now - 31 * day)
    await utimes(memos(`.trash/${oldPath}`), aged, aged)

    expect(await store.purgeTrash(now)).toEqual({ memos: 1, images: 1 })
    expect((await store.trashList()).map((t) => t.title)).toEqual(['최근'])
    expect(await readdir(memos('.trash'))).toEqual(['최근.md'])
    expect(await readdir(memos('일/assets'))).toEqual([])
    // 지울 것이 없으면 아무것도 하지 않는다
    expect(await store.purgeTrash(now)).toEqual({ memos: 0, images: 0 })
  })

  it('딱 30일이 안 된 메모는 남긴다', async () => {
    const memo = await store.create({ ...input('경계'), folder: '' })
    const { trashPath } = await store.remove(memo.id)
    const now = Date.now()
    const almost = new Date(now - (30 * 24 * 60 * 60 * 1000 - 60_000))
    await utimes(memos(`.trash/${trashPath}`), almost, almost)
    expect(await store.purgeTrash(now)).toEqual({ memos: 0, images: 0 })
  })

  it('SVG 와 이미지가 아닌 파일을 거부한다', async () => {
    const memo = await store.create({ ...input('그림'), folder: '' })
    await rejects(store.saveImage(memo.id, SVG), 'unsupported_type')
    await rejects(store.saveImage(memo.id, new TextEncoder().encode('hello')), 'unsupported_type')
  })
})

describe('폴더', () => {
  it('메모가 남은 폴더는 지우지 않는다', async () => {
    await store.createFolder('', '일')
    const memo = await store.create({ ...input('남음'), folder: '일' })
    await rejects(store.deleteFolder('일'), 'conflict')
    await store.remove(memo.id)
    // 휴지통의 메모가 이 폴더의 이미지를 쓰지 않으면 지울 수 있다
    await store.deleteFolder('일')
    expect((await store.tree()).folders).toEqual([])
  })

  it('휴지통 메모가 쓰는 이미지가 남은 폴더는 지우지 않는다', async () => {
    await store.createFolder('', '일')
    const memo = await store.create({ ...input('그림'), folder: '일' })
    const { src } = await store.saveImage(memo.id, PNG)
    await store.update(memo.id, { ...input('그림', `![](${src})`), baseVersion: (await store.get(memo.id)).version })
    await store.remove(memo.id)
    await rejects(store.deleteFolder('일'), 'conflict')
  })

  it('폴더를 다른 폴더로 옮기면 안의 메모·이미지가 따라가고 id 는 그대로다', async () => {
    await store.createFolder('', '가')
    await store.createFolder('', '나')
    const memo = await store.create({ ...input('안쪽'), folder: '가' })
    const { src } = await store.saveImage(memo.id, PNG)
    await store.update(memo.id, { ...input('안쪽', `![](${src})`), baseVersion: (await store.get(memo.id)).version })

    expect(await store.moveFolder('가', '나')).toEqual({ path: '나/가' })
    const moved = await store.get(memo.id)
    expect(moved.path).toBe('나/가/안쪽.md')
    expect((await store.imageFile(`나/가/${src}`)).type).toBe('image/png')

    expect(await store.moveFolder('나/가', '')).toEqual({ path: '가' })
  })

  it('폴더를 자기 자신·하위 폴더 안으로 옮기지 못하고, 같은 이름이 있으면 거부한다', async () => {
    await store.createFolder('', '가')
    await store.createFolder('가', '하위')
    await store.createFolder('', '나')
    await store.createFolder('나', '가')
    await rejects(store.moveFolder('가', '가'), 'bad_request')
    await rejects(store.moveFolder('가', '가/하위'), 'bad_request')
    await rejects(store.moveFolder('가', '나'), 'conflict')
    await rejects(store.moveFolder('', '나'), 'bad_request')
  })

  it('폴더 트리에서 assets 와 휴지통을 숨긴다', async () => {
    await store.createFolder('', '일')
    await store.createFolder('일', '하위')
    const memo = await store.create({ ...input('a'), folder: '일' })
    await store.saveImage(memo.id, PNG)
    const { folders } = await store.tree()
    expect(folders).toEqual([{ path: '일', name: '일', children: [{ path: '일/하위', name: '하위', children: [] }] }])
  })
})

describe('검색·캘린더', () => {
  it('제목과 본문에서 찾고 휴지통은 뺀다', async () => {
    await store.create({ ...input('Apple 메모', '첫 줄'), folder: '' })
    const other = await store.create({ ...input('다른 것', '본문에 apple 이 있다'), folder: '' })
    const trashed = await store.create({ ...input('apple 휴지통'), folder: '' })
    await store.remove(trashed.id)
    const hits = await store.search('APPLE')
    expect(hits.map((h) => h.title).sort()).toEqual(['Apple 메모', '다른 것'])
    expect(hits.find((h) => h.id === other.id)!.snippet).toContain('apple')
  })

  it('기간과 겹치는 일정과 기간 안에 만든 메모를 준다', async () => {
    await store.create({ ...input('하루', '', { date: '2026-10-10' }), done: false, folder: '' })
    await store.create({ ...input('걸침', '', { date: '2026-09-28', dateEnd: '2026-10-02' }), done: false, folder: '' })
    await store.create({ ...input('밖', '', { date: '2026-11-05' }), done: false, folder: '' })
    const { scheduled, created } = await store.calendar('2026-10-01', '2026-10-31')
    expect(scheduled.map((m) => m.title).sort()).toEqual(['걸침', '하루'])
    // created 는 오늘(KST) — 테스트가 도는 날에 따라 기간 밖일 수 있으므로 넓은 기간으로 따로 본다
    expect(created).toBeDefined()
    const wide = await store.calendar('2000-01-01', '2100-12-31')
    expect(wide.created).toHaveLength(3)
  })

  it('캘린더 대조용 목록 — id 와 날짜가 있는 미완료 할 일만, total 은 휴지통까지 센 파일 수', async () => {
    const dated = await store.create({ ...input('날짜', '', { date: '2026-10-10' }), done: false, folder: '' })
    await store.create({ ...input('날짜 없음'), folder: '' })
    const trashed = await store.create({ ...input('휴지통', '', { date: '2026-10-11' }), done: false, folder: '' })
    await store.remove(trashed.id)
    // id 없이 밖에서 만든 파일 — 경로 id(p:)라 아직 잇지 않는다
    await externalWrite('할 일/밖.md', '---\ntitle: 밖\ndate: 2026-10-12\ndone: false\n---\n\n본문\n')
    const { total, memos } = await store.calendarSnapshot()
    expect(total).toBe(4)
    expect(memos.map((m) => m.id)).toEqual([dated.id])
  })

  it('하나뿐인 메모를 휴지통에 넣어도 total 은 0 이 아니다 — 대조가 그 일정을 지울 수 있게', async () => {
    const only = await store.create({ ...input('하나', '', { date: '2026-10-10' }), done: false, folder: '' })
    await store.remove(only.id)
    expect(await store.calendarSnapshot()).toEqual({ total: 1, memos: [] })
  })

  it('태그를 저장하고, 수정에 태그가 없으면 파일의 태그를 그대로 둔다', async () => {
    const memo = await store.create({ ...input('태그'), tags: ['업무', '#회의'], folder: '' })
    expect(memo.tags).toEqual(['업무', '회의'])
    const kept = await store.update(memo.id, { ...input('태그', '본문만 고침'), baseVersion: memo.version })
    expect(kept.tags).toEqual(['업무', '회의'])
    const cleared = await store.update(memo.id, { ...input('태그'), tags: [], baseVersion: kept.version })
    expect(cleared.tags).toEqual([])
    expect(await readFile(memos('태그.md'), 'utf8')).not.toContain('tags')
  })

  it('#태그 로 거르고, 글자와 같이 쓰면 둘 다 맞는 것만', async () => {
    await store.create({ ...input('회의록', '분기 계획'), tags: ['업무'], folder: '' })
    await store.create({ ...input('장보기', '회의 끝나고 장보기'), tags: ['개인'], folder: '' })
    await store.create({ ...input('Plan', '계획'), tags: ['Work', '업무'], folder: '' })
    expect((await store.search('#업무')).map((h) => h.title).sort()).toEqual(['Plan', '회의록'])
    expect((await store.search('#work')).map((h) => h.title)).toEqual(['Plan'])
    expect((await store.search('#업무 분기')).map((h) => h.title)).toEqual(['회의록'])
    expect((await store.search('#개인 #업무')).map((h) => h.title)).toEqual([])
    expect((await store.search('#업무'))[0]!.tags.length).toBeGreaterThan(0)
  })

  it('끝 날짜가 시작과 같거나 잘못된 frontmatter 날짜는 무시한다', async () => {
    await externalWrite('이상.md', '---\ntitle: 이상\ndate: 2026-02-30\n---\n\n본문\n')
    const meta = (await store.tree()).memos[0]!
    expect(meta.date).toBeNull()
  })
})

describe('할 일 (done)', () => {
  it('할 일로 만들면 「할 일」 폴더에 done: false 로 생기고(폴더가 없으면 만든다), 일반 메모는 null', async () => {
    const todo = await store.create({ ...input('우유 사기', ''), done: false, folder: '' })
    expect(todo).toMatchObject({ done: false, folder: '할 일', priority: 'medium' })
    const raw = await readFile(memos('할 일/우유 사기.md'), 'utf8')
    expect(raw).toContain('done: false\n')
    // 중은 기본이라 적지 않는다
    expect(raw).not.toContain('priority')
    const memo = await store.create({ ...input('그냥 메모'), folder: '' })
    expect(memo.done).toBeNull()
    expect(await readFile(memos('그냥 메모.md'), 'utf8')).not.toContain('done')
  })

  it('「할 일」 폴더에 만들면 할 일이다 (템플릿으로 만들어도)', async () => {
    await store.createFolder('', '할 일')
    expect((await store.create({ ...input('그 폴더에'), folder: '할 일' })).done).toBe(false)
  })

  it('체크는 done 만 바꾼다 — 본문·updated·버전·자리는 그대로', async () => {
    const todo = await store.create({ ...input('보고서', '첫 줄\n\n둘째 줄'), done: false, folder: '' })
    const before = await readFile(memos('할 일/보고서.md'), 'utf8')
    const checked = await store.setDone(todo.id, true)
    expect(checked).toMatchObject({ id: todo.id, done: true, updated: todo.updated, folder: '할 일' })
    const after = await readFile(memos('할 일/보고서.md'), 'utf8')
    expect(after).toBe(before.replace('done: false', 'done: true'))
    expect((await store.get(todo.id)).version).toBe(todo.version)
  })

  it('체크한 뒤에도 열려 있던 편집기의 저장(옛 버전)이 통과하고 done 은 그대로 남는다', async () => {
    const todo = await store.create({ ...input('편집 중'), done: false, folder: '' })
    await store.setDone(todo.id, true)
    const saved = await store.update(todo.id, { ...input('편집 중', '고친 본문'), baseVersion: todo.version })
    expect(saved).toMatchObject({ done: true, content: '고친 본문\n' })
  })

  it('할 일로 두면 「할 일」 폴더로 옮기고(이미지도 따라간다), 풀면 키를 지우고 최상위로 옮긴다', async () => {
    await store.createFolder('', '업무')
    const memo = await store.create({ ...input('메모'), folder: '업무' })
    const { src } = await store.saveImage(memo.id, PNG)
    const opened = await store.get(memo.id)
    await store.update(memo.id, { ...input('메모', `![](${src})\n`), baseVersion: opened.version })

    const todo = await store.setDone(memo.id, false)
    expect(todo).toMatchObject({ done: false, folder: '할 일', path: '할 일/메모.md' })
    expect(await readFile(memos('할 일/메모.md'), 'utf8')).toContain('done: false')
    expect(await readdir(memos('할 일/assets'))).toHaveLength(1)
    expect(await readdir(memos('업무'))).toEqual(['assets'])

    await store.setPriority(memo.id, 'high')
    const plain = await store.setDone(memo.id, null)
    expect(plain).toMatchObject({ done: null, priority: 'medium', folder: '', path: '메모.md' })
    const raw = await readFile(memos('메모.md'), 'utf8')
    expect(raw).not.toContain('done')
    expect(raw).not.toContain('priority')
  })

  it('옮기면 할 일 상태가 폴더를 따라간다 — 「할 일」 로 들어가면 할 일, 나가면 일반 메모', async () => {
    await store.createFolder('', '업무')
    await store.createFolder('', '할 일')
    const memo = await store.create({ ...input('끌어 넣기'), folder: '업무' })
    expect((await store.move(memo.id, '할 일')).done).toBe(false)
    expect(await readFile(memos('할 일/끌어 넣기.md'), 'utf8')).toContain('done: false')

    await store.setDone(memo.id, true)
    await store.setPriority(memo.id, 'low')
    const out = await store.move(memo.id, '업무')
    expect(out).toMatchObject({ done: null, priority: 'medium', folder: '업무' })
    expect(await readFile(memos('업무/끌어 넣기.md'), 'utf8')).not.toMatch(/done|priority/)
    // 「할 일」 폴더 안의 하위 폴더(앱에선 못 만들고 밖에서 만든 것)는 할 일 폴더가 아니다
    await mkdir(memos('할 일/보관'))
    expect((await store.move(memo.id, '할 일/보관')).done).toBeNull()
  })

  it('밖에서 쓴 done: yes 는 메모로 보고, 수정 저장이 그 값을 건드리지 않는다', async () => {
    await externalWrite('밖.md', '---\ntitle: 밖\ndone: yes\n---\n\n본문\n')
    const meta = (await store.tree()).memos[0]!
    expect(meta.done).toBeNull()
    const opened = await store.get(meta.id)
    await store.update(meta.id, { ...input('밖', '고침'), baseVersion: opened.version })
    expect(await readFile(memos('밖.md'), 'utf8')).toContain('done: yes\n')
  })

  it('frontmatter 를 읽지 못하는 파일은 체크하지 않는다', async () => {
    await externalWrite('깨짐.md', '---\ntitle: [x\n---\n\n본문\n')
    const meta = (await store.tree()).memos[0]!
    await rejects(store.setDone(meta.id, true), 'unreadable')
    await rejects(store.setDone('01JZZZZZZZZZZZZZZZZZZZZZZZ', true), 'not_found')
  })

  it('날짜 있는 일반 메모와 끝난 할 일은 일정·구글 대조에서 빠지고, 「이날 만든 메모」에는 남는다', async () => {
    const open = await store.create({ ...input('안 끝남', '', { date: '2026-10-10' }), done: false, folder: '' })
    const finished = await store.create({ ...input('끝남', '', { date: '2026-10-11' }), done: false, folder: '' })
    const journal = await store.create({ ...input('일지', '기록', { date: '2026-10-12' }), folder: '' })
    await store.setDone(finished.id, true)
    const { scheduled } = await store.calendar('2026-10-01', '2026-10-31')
    expect(scheduled.map((m) => m.title)).toEqual(['안 끝남'])
    expect((await store.calendar('2000-01-01', '2100-12-31')).created).toHaveLength(3)
    const snapshot = await store.calendarSnapshot()
    expect(snapshot.memos.map((m) => m.id)).toEqual([open.id])
    expect(snapshot.total).toBe(3)
    expect(await store.get(journal.id)).toMatchObject({ date: '2026-10-12', done: null, content: '기록\n' })
  })
})

describe('「할 일」 폴더는 앱이 정한 자리', () => {
  it('이름 바꾸기·옮기기·지우기·하위 폴더·안으로 폴더 넣기를 거절한다', async () => {
    await store.createFolder('', '할 일')
    await store.createFolder('', '업무')
    await rejects(store.renameFolder('할 일', '할일'), 'bad_request')
    await rejects(store.moveFolder('할 일', '업무'), 'bad_request')
    await rejects(store.deleteFolder('할 일'), 'bad_request')
    await rejects(store.createFolder('할 일', '보관'), 'bad_request')
    await rejects(store.moveFolder('업무', '할 일'), 'bad_request')
    // 다른 폴더가 그 경로가 되면 안의 일반 메모가 할 일 폴더에 놓인다
    await store.createFolder('업무', '할 일')
    await rejects(store.moveFolder('업무/할 일', ''), 'bad_request')
    expect((await store.tree()).folders.map((f) => f.path)).toEqual(['업무', '할 일'])
  })

  it('이름을 「할 일」 로 바꾸는 것도 거절한다 (그 폴더가 없을 때도)', async () => {
    await store.createFolder('', '업무')
    await rejects(store.renameFolder('업무', '할 일'), 'bad_request')
  })

  it('순서를 정하지 않고, 예전에 적힌 순서 파일도 읽지 않는다', async () => {
    const t = await store.create({ ...input('할 일 하나'), done: false, folder: '' })
    await rejects(store.setOrder('할 일', { memos: [t.id] }), 'bad_request')
    await writeFile(memos('할 일/.order.json'), JSON.stringify({ memos: [t.id] }))
    expect((await store.tree()).orders).toEqual({})
  })
})

describe('할 일 중요도 (priority)', () => {
  it('만들 때 정하고, priority 줄만 바꾼다 — 버전은 그대로라 열린 편집기의 저장이 막히지 않는다', async () => {
    const todo = await store.create({ ...input('급한 일'), done: false, priority: 'high', folder: '' })
    expect(todo.priority).toBe('high')
    expect(await readFile(memos('할 일/급한 일.md'), 'utf8')).toContain('priority: high\n')
    expect((await store.setPriority(todo.id, 'low')).priority).toBe('low')
    expect((await store.get(todo.id)).version).toBe(todo.version)
    const saved = await store.update(todo.id, { ...input('급한 일', '고침'), baseVersion: todo.version })
    expect(saved.priority).toBe('low')
    // 중으로 돌리면 키를 지운다
    await store.setPriority(todo.id, 'medium')
    expect(await readFile(memos('할 일/급한 일.md'), 'utf8')).not.toContain('priority')
  })

  it('할 일이 아니면 거절한다. 일반 메모로 만들 때 준 중요도는 버린다', async () => {
    const memo = await store.create({ ...input('메모'), priority: 'high', folder: '' })
    expect(memo.priority).toBe('medium')
    await rejects(store.setPriority(memo.id, 'high'), 'bad_request')
  })

  it('밖에서 쓴 모르는 값은 중으로 읽고 건드리지 않는다', async () => {
    await mkdir(memos('할 일'))
    await externalWrite('할 일/밖.md', '---\ntitle: 밖\ndone: false\npriority: urgent\n---\n\n본문\n')
    const meta = (await store.tree()).memos[0]!
    expect(meta.priority).toBe('medium')
    await store.setDone(meta.id, true)
    expect(await readFile(memos('할 일/밖.md'), 'utf8')).toContain('priority: urgent\n')
  })
})

describe('외부 공개 (public)', () => {
  it('켜기는 public 만 바꾼다 — 본문·updated·버전은 그대로, 열린 편집기의 저장도 통과하고 값은 남는다', async () => {
    const memo = await store.create({ ...input('여행 동선', '첫 줄'), folder: '' })
    expect(memo.public).toBe(false)
    const before = await readFile(memos('여행 동선.md'), 'utf8')
    const on = await store.setPublic(memo.id, true)
    expect(on).toMatchObject({ id: memo.id, public: true, updated: memo.updated })
    const after = await readFile(memos('여행 동선.md'), 'utf8')
    expect(after).toBe(before.replace('---\n\n', 'public: true\n---\n\n'))
    expect((await store.get(memo.id)).version).toBe(memo.version)

    const saved = await store.update(memo.id, { ...input('여행 동선', '고친 본문'), baseVersion: memo.version })
    expect(saved).toMatchObject({ public: true, content: '고친 본문\n' })
    expect((await store.tree()).memos[0]).toMatchObject({ public: true })

    expect((await store.setPublic(memo.id, false)).public).toBe(false)
    expect(await readFile(memos('여행 동선.md'), 'utf8')).not.toContain('public')
  })

  it('공개한 메모만 제목·본문·수정 시각을 준다 — 없는 메모·비공개·휴지통은 똑같이 «없음»', async () => {
    const memo = await store.create({ ...input('공유할 글', '## 안내\n\n내용'), date: '2026-10-20', tags: ['비밀'], folder: '' })
    await rejects(store.publicMemo(memo.id), 'not_found')
    await store.setPublic(memo.id, true)
    const shown = await store.publicMemo(memo.id)
    expect(shown).toEqual({ title: '공유할 글', content: '## 안내\n\n내용\n', updated: memo.updated })
    // 폴더·태그·날짜는 내보내지 않는다
    expect(Object.keys(shown).sort()).toEqual(['content', 'title', 'updated'])

    await rejects(store.publicMemo('01JZZZZZZZZZZZZZZZZZZZZZZZ'), 'not_found')
    await rejects(store.publicMemo('../etc/passwd'), 'not_found')
    await store.remove(memo.id)
    await rejects(store.publicMemo(memo.id), 'not_found')
  })

  it('밖에서 고친 본문이 바로 보인다 (재스캔)', async () => {
    const memo = await store.create({ ...input('글', '처음'), folder: '' })
    await store.setPublic(memo.id, true)
    const raw = await readFile(memos('글.md'), 'utf8')
    await externalWrite('글.md', raw.replace('처음', '밖에서 고침'))
    expect((await store.publicMemo(memo.id)).content).toBe('밖에서 고침\n')
  })

  it('id 가 없는 파일(경로 id)은 공개하지 않는다 — 주소에 폴더·파일 이름이 드러난다', async () => {
    await externalWrite('밖.md', '---\ntitle: 밖\n---\n\n본문\n')
    const meta = (await store.tree()).memos[0]!
    expect(meta.id.startsWith('p:')).toBe(true)
    await rejects(store.setPublic(meta.id, true), 'bad_request')
    // 밖에서 public: true 를 적었어도 경로 id 로는 열리지 않는다
    await externalWrite('밖.md', '---\ntitle: 밖\npublic: true\n---\n\n본문\n')
    await rejects(store.publicMemo(meta.id), 'not_found')
    expect((await store.setPublic(meta.id, false)).public).toBe(false)
  })

  it('이미지는 그 메모가 본문에서 참조하는 것만 — 같은 assets 의 다른 이미지·원본은 안 나간다', async () => {
    await store.createFolder('', '여행')
    const memo = await store.create({ ...input('사진'), folder: '여행' })
    const shown = await store.saveImage(memo.id, PNG, PNG)
    const hidden = await store.saveImage(memo.id, PNG)
    const opened = await store.get(memo.id)
    await store.update(memo.id, { ...input('사진', `![](${shown.src})\n`), baseVersion: opened.version })

    await rejects(store.publicImage(memo.id, shown.src), 'not_found')
    await store.setPublic(memo.id, true)
    const file = await store.publicImage(memo.id, shown.src)
    expect(file.abs).toBe(memos(`여행/${shown.src}`))
    await rejects(store.publicImage(memo.id, hidden.src), 'not_found')
    await rejects(store.publicImage(memo.id, shown.src.replace(/\.png$/, '.orig.png')), 'not_found')
    await rejects(store.publicImage(memo.id, `../여행/${hidden.src}`), 'not_found')
    await rejects(store.publicImage(memo.id, `/api/files/여행/${shown.src}`), 'not_found')

    await store.setPublic(memo.id, false)
    await rejects(store.publicImage(memo.id, shown.src), 'not_found')
  })
})

describe('순서 (.order.json)', () => {
  it('처음엔 순서가 없고, 바꾸면 그 폴더의 순서 파일에만 남는다', async () => {
    await store.createFolder('', '업무')
    const a = await store.create({ ...input('가'), folder: '업무' })
    const b = await store.create({ ...input('나'), folder: '업무' })
    expect((await store.tree()).orders).toEqual({})

    await store.setOrder('업무', { memos: [a.id, b.id] })
    const tree = await store.tree()
    expect(tree.orders).toEqual({ 업무: { folders: [], memos: [a.id, b.id] } })
    expect(JSON.parse(await readFile(memos('업무/.order.json'), 'utf8'))).toEqual({ memos: [a.id, b.id] })
    // 순서 파일은 메모·폴더 목록에 끼지 않고, 메모 파일은 그대로다
    expect(tree.memos.map((m) => m.title).sort()).toEqual(['가', '나'])
    expect(tree.folders.map((f) => f.name)).toEqual(['업무'])
    expect((await store.get(a.id)).version).toBe(a.version)
  })

  it('넘긴 목록만 바꾼다 (폴더 순서를 바꿔도 메모 순서는 남는다)', async () => {
    await store.createFolder('', '가')
    await store.createFolder('', '나')
    const m = await store.create({ ...input('메모'), folder: '' })
    await store.setOrder('', { memos: [m.id] })
    await store.setOrder('', { folders: ['나', '가'] })
    expect((await store.tree()).orders['']).toEqual({ folders: ['나', '가'], memos: [m.id] })
  })

  it('예전 할 일 화면 순서(최상위 파일의 todos)는 읽지 않고, 최상위 순서를 저장하면 빠진다', async () => {
    await writeFile(memos('.order.json'), JSON.stringify({ todos: ['x'] }))
    expect((await store.tree()).orders).toEqual({})
    await store.setOrder('', { folders: ['가'] })
    expect(JSON.parse(await readFile(memos('.order.json'), 'utf8'))).toEqual({ folders: ['가'] })
  })

  it('폴더 이름을 바꾸면 위 폴더 순서의 이름도 바뀐다 (자리 유지)', async () => {
    await store.createFolder('', '가')
    await store.createFolder('', '나')
    await store.setOrder('', { folders: ['나', '가'] })
    await store.renameFolder('나', '다')
    expect((await store.tree()).orders['']?.folders).toEqual(['다', '가'])
  })

  it('폴더를 옮기면 안의 순서 파일도 따라가고, 지울 때 막지 않는다', async () => {
    await store.createFolder('', '상자')
    await store.createFolder('', '안')
    await store.setOrder('안', { folders: ['x'] })
    await store.moveFolder('안', '상자')
    expect((await store.tree()).orders['상자/안']).toEqual({ folders: ['x'], memos: [] })
    await store.deleteFolder('상자/안')
    expect(await readdir(memos('상자'))).toEqual([])
  })

  it('깨진 순서 파일은 순서 없음으로 읽는다', async () => {
    await store.createFolder('', '업무')
    await writeFile(memos('업무/.order.json'), '{ 깨짐')
    expect((await store.tree()).orders).toEqual({})
    await writeFile(memos('.order.json'), JSON.stringify({ folders: ['업무', 3, '업무'], todos: 'x' }))
    expect((await store.tree()).orders['']).toEqual({ folders: ['업무'], memos: [] })
  })

  it('없는 폴더의 순서는 거절한다', async () => {
    await rejects(store.setOrder('없음', { memos: [] }), 'not_found')
    await rejects(store.setOrder('../밖', { memos: [] }), 'bad_request')
  })
})
