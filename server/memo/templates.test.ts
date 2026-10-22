import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ulid } from '../../shared/utils/ulid'
import * as fsx from './fsx'
import { MemoHistory } from './history'
import { templateAssetPath } from './template-assets'
import { imageRefs } from './image-refs'
import { MemoStore } from './store'
import { MemoTemplates, templateFolderInput, templateNameInput, templateSaveInput, TEMPLATE_STAGING_MAX_AGE } from './templates'

let root: string
let store: MemoStore
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// 할 일로 만들면 「할 일」 폴더에 생긴다 — 이미지 경로를 최상위로 보는 테스트가 많아서 기본은 일반 메모
const create = (title = '회의', content = '- [x] 완료\n\n<table><tr><td>표</td></tr></table>', done?: boolean) => store.create({ title, content, folder: '', date: '2026-10-21', dateEnd: '2026-10-22', tags: ['업무'], ...(done === undefined ? {} : { done }) })
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'memo-templates-')); store = new MemoStore(root); await store.init() })
afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }) })

describe('내 템플릿', () => {
  it('원본 파일을 바꾸지 않고 별도 저장·목록·이름 변경·삭제한다', async () => {
    const memo = await create()
    expect(templateSaveInput({ memoId: memo.id, name: '회의 양식', baseVersion: memo.version })).toEqual({ memoId: memo.id, name: '회의 양식', baseVersion: memo.version })
    const raw = await readFile(join(root, memo.path), 'utf8')
    const template = await store.saveTemplate(memo.id, '  회의 양식  ', memo.version)
    expect(template).toMatchObject({ name: '회의 양식' })
    expect(template).not.toHaveProperty('content')
    expect(await store.templateList()).toEqual([template])
    expect(await store.getTemplate(template.id)).toMatchObject({ title: memo.title, content: memo.content, tags: memo.tags })
    expect(await store.renameTemplate(template.id, '새 이름')).toMatchObject({ name: '새 이름' })
    expect(await readFile(join(root, memo.path), 'utf8')).toBe(raw)
    expect((await store.tree()).memos).toHaveLength(1)
    expect((await store.tree()).folders).toEqual([])
    await store.removeTemplate(template.id)
    expect(await store.templateList()).toEqual([])
    expect(await store.get(memo.id)).toMatchObject({ version: memo.version })
  })
  it('새 ID·현재 폴더로 만들고 날짜·완료·공개를 초기화하며 본문과 체크 상태를 그대로 둔다', async () => {
    const memo = await create(undefined, undefined, true)
    await store.setPublic(memo.id, true)
    const template = await store.saveTemplate(memo.id, '양식', memo.version)
    await store.createFolder('', '현재 폴더')
    const first = await store.createFromTemplate(template.id, '현재 폴더')
    const second = await store.createFromTemplate(template.id, '현재 폴더')
    expect(first.id).not.toBe(memo.id)
    expect(second.id).not.toBe(first.id)
    expect(second.path).not.toBe(first.path)
    expect(first).toMatchObject({ folder: '현재 폴더', title: memo.title, content: memo.content, tags: ['업무'], done: null, public: false, date: null, dateEnd: null })
    expect(first.created).toBeTruthy()
    // 「할 일」 폴더에 만들면 안 끝난 할 일
    expect((await store.createFromTemplate(template.id, '할 일')).done).toBe(false)
  })
  it('오래된 버전·읽기 불가·삭제 메모 저장과 잘못된 ID·이름·폴더를 거절한다', async () => {
    const memo = await create()
    const newer = await store.update(memo.id, { title: '수정', content: '수정', date: null, dateEnd: null, baseVersion: memo.version })
    await expect(store.saveTemplate(memo.id, '양식', memo.version)).rejects.toMatchObject({ code: 'conflict', extra: { version: newer.version } })
    await expect(store.saveTemplate(memo.id, ' '.repeat(2), newer.version)).rejects.toMatchObject({ code: 'bad_request' })
    await expect(store.saveTemplate(memo.id, 'x'.repeat(201), newer.version)).rejects.toMatchObject({ code: 'bad_request' })
    await expect(store.getTemplate('../escape')).rejects.toMatchObject({ code: 'bad_request' })
    const template = await store.saveTemplate(memo.id, '양식', newer.version)
    await expect(store.createFromTemplate(template.id, '../outside')).rejects.toMatchObject({ code: 'bad_request' })
    await expect(store.createFromTemplate(template.id, '없는 폴더')).rejects.toMatchObject({ code: 'not_found' })
    await store.remove(memo.id)
    await expect(store.saveTemplate(memo.id, '양식', newer.version)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('이미지·원본·HTML 표 이미지를 독립 복사하고 원본 영구 삭제·GC·템플릿 삭제 후에도 새 메모를 보존한다', async () => {
    let memo = await create('사진', '')
    const image = await store.saveImage(memo.id, PNG, PNG)
    memo = await store.update(memo.id, { title: memo.title, content: `<table><tr><td><img alt="<!--" src="${image.src}"></td></tr></table>\n\n![사진](${image.src})\n\n\`![예시](${image.src})\``, date: null, dateEnd: null, baseVersion: memo.version })
    const template = await store.saveTemplate(memo.id, '사진 양식', memo.version)
    expect((await readdir(join(root, '.templates', template.id))).filter(name => name.endsWith('.png'))).toHaveLength(2)
    await store.remove(memo.id)
    await store.emptyTrash()
    const first = await store.createFromTemplate(template.id, '')
    const refs = imageRefs(first.content)
    expect(refs).toHaveLength(2)
    expect(refs[0]!.src).toBe(refs[1]!.src)
    expect(refs[0]!.src).not.toBe(image.src)
    expect(first.content).toContain(`\`![예시](${image.src})\``)
    const imagePath = refs[0]!.src
    expect(await readFile(join(root, imagePath))).toEqual(PNG)
    expect(await readFile(join(root, imagePath.replace('.png', '.orig.png')))).toEqual(PNG)
    await store.removeTemplate(template.id)
    const discarded = await create('쓰레기')
    await store.remove(discarded.id)
    await store.emptyTrash()
    expect(await readFile(join(root, imagePath))).toEqual(PNG)
    expect(await readFile(join(root, imagePath.replace('.png', '.orig.png')))).toEqual(PNG)
    expect(await store.get(first.id)).toMatchObject({ content: first.content })
  })
  it('들여쓴 목록·HTML 표·엔티티 경로 이미지는 GC와 템플릿·이력 복사에서 보존한다', async () => {
    await store.createFolder('', 'A&B')
    let memo = await store.create({ title: '들여쓴 사진', content: '', folder: 'A&B', date: null, dateEnd: null })
    const image = await store.saveImage(memo.id, PNG, PNG)
    const body = `- 목록\n\n    ![사진](${image.src})\n<table>\n    <tr><td><img src="${image.src}"></td></tr>\n</table>\n<img src="/api/files/A&amp;B/${image.src}">\n<img src="/api/files/A%26B/${image.src}">`
    memo = await store.update(memo.id, { title: memo.title, content: body, date: null, dateEnd: null, baseVersion: memo.version })
    await store.emptyTrash()
    expect(await readFile(join(root, 'A&B', image.src))).toEqual(PNG)
    const template = await store.saveTemplate(memo.id, '들여쓴 양식', memo.version)
    await new MemoHistory(root).capture(memo.id, memo, memo.folder, true)
    const revision = (await store.getRevisions(memo.id)).find(entry => entry.contentLength === memo.content.length)!
    memo = await store.update(memo.id, { title: memo.title, content: '제거', date: null, dateEnd: null, baseVersion: memo.version })
    await store.emptyTrash()
    await expect(readFile(join(root, 'A&B', image.src))).rejects.toMatchObject({ code: 'ENOENT' })
    const created = await store.createFromTemplate(template.id, '')
    const restored = await store.restoreRevision(memo.id, revision.id, memo.version)
    for (const result of [created, restored]) {
      expect(imageRefs(result.content)).toHaveLength(4)
      for (const ref of imageRefs(result.content)) {
        const path = templateAssetPath(result.folder, ref.src)!
        expect(await readFile(join(root, path))).toEqual(PNG)
        expect(await readFile(join(root, path.replace('.png', '.orig.png')))).toEqual(PNG)
      }
    }
  })
  it('HTML 표 안 fence 문자를 이미지 삭제·snapshot 누락으로 오판하지 않는다', async () => {
    let memo = await create('HTML fence', '')
    const image = await store.saveImage(memo.id, PNG, PNG)
    const body = `<table>\n<tr><td><img alt="예시\n\`\`\`\n설명" src="${image.src}"></td></tr>\n<tr><td>\n\`\`\`\n<img src="${image.src}">\n</td></tr></table>`
    memo = await store.update(memo.id, { title: memo.title, content: body, date: null, dateEnd: null, baseVersion: memo.version })
    await store.emptyTrash()
    expect(await readFile(join(root, image.src))).toEqual(PNG)
    const template = await store.saveTemplate(memo.id, '표 양식', memo.version)
    await new MemoHistory(root).capture(memo.id, memo, memo.folder, true)
    const revision = (await store.getRevisions(memo.id)).find(entry => entry.contentLength === memo.content.length)!
    memo = await store.update(memo.id, { title: memo.title, content: '제거', date: null, dateEnd: null, baseVersion: memo.version })
    await store.emptyTrash()
    await expect(readFile(join(root, image.src))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const result of [await store.createFromTemplate(template.id, ''), await store.restoreRevision(memo.id, revision.id, memo.version)]) {
      const refs = imageRefs(result.content)
      expect(refs).toHaveLength(2)
      for (const ref of refs) expect(await readFile(join(root, ref.src))).toEqual(PNG)
    }
  })
  it('누락 이미지·경로 탈출·심볼릭 링크는 완성 템플릿이나 staging을 남기지 않는다', async () => {
    let memo = await create('실패', '![누락](assets/missing.png)')
    await expect(store.saveTemplate(memo.id, '양식', memo.version)).rejects.toMatchObject({ code: 'unreadable' })
    expect(await readdir(join(root, '.templates'))).toEqual([])
    memo = await store.update(memo.id, { title: memo.title, content: '![탈출](../../outside/assets/x.png)', date: null, dateEnd: null, baseVersion: memo.version })
    await expect(store.saveTemplate(memo.id, '양식', memo.version)).rejects.toMatchObject({ code: 'bad_request' })
    await mkdir(join(root, 'assets'))
    await symlink(join(root, memo.path), join(root, 'assets', 'link.png'))
    memo = await store.update(memo.id, { title: memo.title, content: '![링크](assets/link.png)', date: null, dateEnd: null, baseVersion: memo.version })
    await expect(store.saveTemplate(memo.id, '양식', memo.version)).rejects.toMatchObject({ code: 'unreadable' })
    expect(await readdir(join(root, '.templates'))).toEqual([])
  })
  it('손상된 manifest와 링크 디렉터리는 목록에서 제외하고 직접 접근도 거절한다', async () => {
    const memo = await create()
    const template = await store.saveTemplate(memo.id, '양식', memo.version)
    const path = join(root, '.templates', template.id, 'template.json')
    const record = JSON.parse(await readFile(path, 'utf8'))
    record.assets = [{ src: 'assets/x.png', file: '../../outside.png' }]
    await writeFile(path, JSON.stringify(record))
    expect(await store.templateList()).toEqual([])
    await expect(store.createFromTemplate(template.id, '')).rejects.toMatchObject({ code: 'unreadable' })
    const id = ulid()
    await symlink(join(root, '.templates', template.id), join(root, '.templates', id))
    await expect(store.getTemplate(id)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('이미지 복사 도중 실패하면 이번 생성 이미지들만 정리한다', async () => {
    let memo = await create('사진', '')
    const image = await store.saveImage(memo.id, PNG, PNG)
    memo = await store.update(memo.id, { title: memo.title, content: `![사진](${image.src})`, date: null, dateEnd: null, baseVersion: memo.version })
    const template = await store.saveTemplate(memo.id, '양식', memo.version)
    const dir = join(root, '.templates', template.id)
    const original = (await readdir(dir)).find(name => name.includes('.orig.'))!
    await rm(join(dir, original))
    const before = await readdir(join(root, 'assets'))
    await expect(store.createFromTemplate(template.id, '')).rejects.toMatchObject({ code: 'unreadable' })
    expect(await readdir(join(root, 'assets'))).toEqual(before)
    expect((await store.tree()).memos).toHaveLength(1)
  })
  it('자기가 만든 하루 지난 staging만 정리하고 완성 템플릿·미지의 파일은 유지한다', async () => {
    const memo = await create()
    const template = await store.saveTemplate(memo.id, '양식', memo.version)
    const own = `.pending-${ulid()}-${randomUUID()}`
    const fresh = `.pending-${ulid()}-${randomUUID()}`
    for (const name of [own, fresh, '.pending-unknown']) await mkdir(join(root, '.templates', name))
    const old = new Date(Date.now() - TEMPLATE_STAGING_MAX_AGE - 1000)
    await utimes(join(root, '.templates', own), old, old)
    await utimes(join(root, '.templates', '.pending-unknown'), old, old)
    expect(await store.purgeHistory()).toBe(1)
    expect(await readdir(join(root, '.templates'))).toEqual(expect.arrayContaining([template.id, fresh, '.pending-unknown']))
    await expect(lstat(join(root, '.templates', own))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await store.getTemplate(template.id)).toBeTruthy()
  })
  it('manifest 쓰기 실패는 staging을 정리하고 원본 이미지·메모를 보존한다', async () => {
    let memo = await create('사진', '')
    const image = await store.saveImage(memo.id, PNG, PNG)
    memo = await store.update(memo.id, { title: memo.title, content: `![사진](${image.src})`, date: null, dateEnd: null, baseVersion: memo.version })
    const original = fsx.writeAtomic
    vi.spyOn(fsx, 'writeAtomic').mockImplementation(async (path, bytes) => {
      if (path.endsWith('/template.json')) throw new Error('합성 manifest 실패')
      return original(path, bytes)
    })
    await expect(store.saveTemplate(memo.id, '양식', memo.version)).rejects.toThrow('합성 manifest 실패')
    expect(await readdir(join(root, '.templates'))).toEqual([])
    expect(await readFile(join(root, image.src))).toEqual(PNG)
    expect(await store.get(memo.id)).toMatchObject({ version: memo.version })
  })
  it('새 메모 게시 실패는 이번에 복사한 이미지만 정리한다', async () => {
    let memo = await create('사진', '')
    const image = await store.saveImage(memo.id, PNG, PNG)
    memo = await store.update(memo.id, { title: memo.title, content: `![사진](${image.src})`, date: null, dateEnd: null, baseVersion: memo.version })
    const template = await store.saveTemplate(memo.id, '양식', memo.version)
    const before = await readdir(join(root, 'assets'))
    const original = fsx.writeAtomic
    vi.spyOn(fsx, 'writeAtomic').mockImplementation(async (path, bytes) => {
      if (path.endsWith('.md')) throw new Error('합성 메모 게시 실패')
      return original(path, bytes)
    })
    await expect(store.createFromTemplate(template.id, '')).rejects.toThrow('합성 메모 게시 실패')
    expect(await readdir(join(root, 'assets'))).toEqual(before)
    expect((await store.tree()).memos).toHaveLength(1)
    expect(await store.getTemplate(template.id)).toBeTruthy()
  })
  it('최대 개수 100개를 넘으면 새 템플릿을 만들지 않는다', async () => {
    const memo = await create()
    const template = await store.saveTemplate(memo.id, '양식', memo.version)
    const raw = JSON.parse(await readFile(join(root, '.templates', template.id, 'template.json'), 'utf8'))
    for (let i = 1; i < 100; i++) {
      const id = ulid()
      await mkdir(join(root, '.templates', id))
      await writeFile(join(root, '.templates', id, 'template.json'), JSON.stringify({ ...raw, template: { ...raw.template, id } }))
    }
    await expect(store.saveTemplate(memo.id, '101번째', memo.version)).rejects.toMatchObject({ code: 'bad_request' })
    expect(await store.templateList()).toHaveLength(100)
  })
  it('요청 입력을 엄격하게 좁힌다', () => {
    expect(() => templateSaveInput(null)).toThrow()
    expect(() => templateSaveInput({ memoId: 'id', name: '양식', baseVersion: 'stale' })).toThrow()
    expect(templateSaveInput({ memoId: 'id', name: ' 양식 ', baseVersion: 'a'.repeat(32) })).toEqual({ memoId: 'id', name: '양식', baseVersion: 'a'.repeat(32) })
    expect(() => templateNameInput({ name: 'x\ny' })).toThrow()
    expect(() => templateFolderInput({ folder: [] })).toThrow()
    expect(templateFolderInput({ folder: '' })).toBe('')
  })
})
