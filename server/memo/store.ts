/**
 * 메모 저장소 — 파일시스템이 원본이다 (설계문서 §3 ~ §6, §9).
 *
 * 🔴 서버가 사용자 파일을 쓰는 경우는 «앱에서 저장»뿐이다. 다른 도구로 열어 둔 파일을 서버가 몰래
 *    고쳐 쓰지 않는다 (구글 일정 연결도 파일에 적지 않는다 — §8.2).
 *
 * 모든 작업은 한 줄로 선다(exclusive). 재스캔이 읽어 둔 옛 내용이 방금 쓴 내용을 덮는 일을 막는다.
 * 한 사람이 쓰는 앱이라 이 직렬화가 병목이 되지 않는다.
 */
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CalendarResponse,
  CreateMemoInput,
  FolderNode,
  Memo,
  MemoMeta,
  SearchHit,
  TrashItem,
  TreeResponse,
  UpdateMemoInput,
} from '../../shared/types/memo'
import { isDateString, kstDay, nowKst } from '../../shared/utils/memo-date'
import { DAY_MS, TRASH_RETENTION_DAYS } from '../../shared/utils/trash'
import { isUlid, ulid } from '../../shared/utils/ulid'
import { MemoError } from './errors'
import { parseMemo, serializeMemo, versionOf } from './file'
import { exists, writeAtomic } from './fsx'
import { extOf, IMAGE_TYPES, MAX_IMAGE_BYTES, referencedImages, sniffImage } from './images'
import {
  ASSETS_DIR,
  TRASH_DIR,
  assertFolder,
  assertName,
  fileBaseFromTitle,
  folderOf,
  insideRoot,
  joinRel,
  uniqueMdPath,
} from './paths'
import { type IndexEntry, MemoIndex } from './scan'

const SNIPPET_RADIUS = 40

export class MemoStore {
  private readonly index: MemoIndex
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly root: string) {
    this.index = new MemoIndex(root)
  }

  async init() {
    await mkdir(join(this.root, TRASH_DIR), { recursive: true })
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private abs(rel: string) {
    return insideRoot(this.root, rel)
  }

  private relExists = async (rel: string) => exists(await this.abs(rel))

  private async requireFolder(folder: string) {
    assertFolder(folder)
    const s = await stat(await this.abs(folder)).catch(() => null)
    if (!s?.isDirectory()) throw new MemoError('not_found', `폴더가 없습니다: ${folder || '(최상위)'}`)
  }

  private requirePath(id: string) {
    const rel = this.index.pathOf(id)
    if (!rel) throw new MemoError('not_found', '메모를 찾을 수 없습니다')
    return rel
  }

  private async read(rel: string): Promise<Memo> {
    const raw = await readFile(await this.abs(rel), 'utf8').catch(() => {
      throw new MemoError('not_found', '메모를 찾을 수 없습니다')
    })
    const entry = this.index.active.get(rel)
    if (!entry) throw new MemoError('not_found', '메모를 찾을 수 없습니다')
    const parsed = parseMemo(raw)
    return { ...this.index.meta(entry), content: parsed.body, version: versionOf(raw) }
  }

  // ── 읽기 ────────────────────────────────────────────────────────────

  tree(): Promise<TreeResponse> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memos = [...this.index.active.values()].map((e) => this.index.meta(e))
      memos.sort((a, b) => a.path.localeCompare(b.path, 'ko'))
      return { folders: await this.folderTree(this.root, ''), memos }
    })
  }

  private async folderTree(dir: string, prefix: string): Promise<FolderNode[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const nodes: FolderNode[] = []
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === ASSETS_DIR) continue
      const path = joinRel(prefix, e.name)
      nodes.push({ path, name: e.name, children: await this.folderTree(join(dir, e.name), path) })
    }
    return nodes.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }

  /** 메모 열기 — 인덱스가 아니라 파일에서 직접 읽는다. 열린 내용은 항상 최신이다 */
  get(id: string): Promise<Memo> {
    return this.exclusive(async () => {
      await this.index.rescan()
      return this.read(this.requirePath(id))
    })
  }

  search(query: string): Promise<SearchHit[]> {
    return this.exclusive(async () => {
      const q = query.trim().toLowerCase()
      if (!q) return []
      await this.index.rescan()
      const hits: SearchHit[] = []
      for (const entry of this.index.active.values()) {
        const meta = this.index.meta(entry)
        const inTitle = meta.title.toLowerCase().includes(q)
        const at = entry.body.toLowerCase().indexOf(q)
        if (!inTitle && at === -1) continue
        const snippet =
          at === -1
            ? entry.body.slice(0, SNIPPET_RADIUS * 2).trim()
            : entry.body.slice(Math.max(0, at - SNIPPET_RADIUS), at + q.length + SNIPPET_RADIUS).trim()
        hits.push({ ...meta, snippet: snippet.replace(/\s+/g, ' ') })
      }
      return hits.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''))
    })
  }

  /** from ~ to (둘 다 포함, `YYYY-MM-DD`) 안에 생성됐거나 일정이 걸친 메모 */
  calendar(from: string, to: string): Promise<CalendarResponse> {
    return this.exclusive(async () => {
      if (!isDateString(from) || !isDateString(to) || to < from) throw new MemoError('bad_request', '기간이 잘못됐습니다')
      await this.index.rescan()
      const created: MemoMeta[] = []
      const scheduled: MemoMeta[] = []
      for (const entry of this.index.active.values()) {
        const meta = this.index.meta(entry)
        const day = meta.created ? kstDay(meta.created) : null
        if (day && day >= from && day <= to) created.push(meta)
        if (meta.date && meta.date <= to && (meta.dateEnd ?? meta.date) >= from) scheduled.push(meta)
      }
      return { created, scheduled }
    })
  }

  /**
   * 구글 캘린더 대조용 (§8.3) — 메모 파일 수(휴지통 포함)와, id 가 있고 날짜가 있는 활성 메모.
   * total 이 0 이면 대조가 «데이터 폴더가 빠졌다»고 보고 삭제를 미룬다. 휴지통을 세는 이유 — 하나뿐인 메모를
   * 휴지통에 넣었을 때 그 일정까지 막히지 않게 (폴더가 정말 빠졌다면 휴지통도 비어 있다).
   * `p:` 경로 id 는 빠진다. 파일 이름이 바뀌면 id 도 바뀌어 일정이 끊기므로, 앱에서 한 번 저장해 id 가 붙은 뒤부터 잇는다.
   */
  calendarSnapshot(): Promise<{ total: number; memos: MemoMeta[] }> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memos = [...this.index.active.values()]
        .map((e) => this.index.meta(e))
        .filter((m) => m.date && !m.id.startsWith('p:'))
      return { total: this.index.active.size + this.index.trash.size, memos }
    })
  }

  // ── 쓰기 ────────────────────────────────────────────────────────────

  create(input: CreateMemoInput): Promise<Memo> {
    return this.exclusive(async () => {
      await this.requireFolder(input.folder)
      await this.index.rescan()
      const now = nowKst()
      const rel = await uniqueMdPath(input.folder, fileBaseFromTitle(input.title), this.relExists)
      const raw = serializeMemo(
        null,
        { id: ulid(), title: input.title, created: now, updated: now, date: input.date, dateEnd: input.dateEnd },
        input.content,
      )
      await writeAtomic(await this.abs(rel), raw)
      await this.index.refresh(rel)
      return this.read(rel)
    })
  }

  update(id: string, input: UpdateMemoInput): Promise<Memo> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const rel = this.requirePath(id)
      const abs = await this.abs(rel)
      const raw = await readFile(abs, 'utf8')
      const current = versionOf(raw)
      if (current !== input.baseVersion) {
        throw new MemoError('conflict', '다른 곳에서 먼저 수정했습니다', { version: current })
      }
      const parsed = parseMemo(raw)
      if (!parsed.ok) {
        throw new MemoError('unreadable', 'frontmatter 를 읽을 수 없어 저장하지 않았습니다. 파일을 직접 고쳐 주세요')
      }

      // 경로 id(`p:`)로 열린 파일 — id 가 없거나 다른 파일과 겹친다. 이번 저장에서 새 id 를 준다
      const keepId = parsed.fields.id && isUlid(parsed.fields.id) && !id.startsWith('p:')
      const now = nowKst()
      const next = serializeMemo(
        parsed.doc,
        {
          id: keepId ? parsed.fields.id : ulid(),
          title: input.title,
          created: parsed.fields.created ?? now,
          updated: now,
          date: input.date,
          dateEnd: input.dateEnd,
        },
        input.content,
      )
      await writeAtomic(abs, next)

      /*
       * 이번 저장에서 제목이 바뀌었을 때만 파일 이름이 따라간다. 밖에서 지은 이름(`meeting.md`)을
       * 앱에서 한 번 저장했다는 이유로 바꾸지 않는다. 같은 이름의 `(2)` 꼴이면 그대로 둔다.
       */
      const folder = folderOf(rel)
      const name = rel.slice(folder ? folder.length + 1 : 0).replace(/\.md$/, '')
      const titleChanged = input.title !== (parsed.fields.title ?? name)
      const base = fileBaseFromTitle(input.title)
      const sameBase = name === base || (name.startsWith(base) && /^ \(\d+\)$/.test(name.slice(base.length)))
      let finalRel = rel
      if (titleChanged && !sameBase) {
        finalRel = await uniqueMdPath(folder, base, this.relExists)
        await rename(abs, await this.abs(finalRel))
      }
      await this.index.refresh(rel)
      if (finalRel !== rel) await this.index.refresh(finalRel)
      return this.read(finalRel)
    })
  }

  /** 다른 폴더로 옮긴다. 같은 폴더의 `assets/` 에 있는 참조 이미지도 따라간다 (§4) */
  move(id: string, folder: string): Promise<MemoMeta> {
    return this.exclusive(async () => {
      await this.requireFolder(folder)
      await this.index.rescan()
      const rel = this.requirePath(id)
      const from = folderOf(rel)
      const entry = this.index.active.get(rel)!
      if (from === folder) return this.index.meta(entry)

      const ownAssets = joinRel(from, `${ASSETS_DIR}/`)
      const images = [...referencedImages(from, entry.body)].filter((p) => p.startsWith(ownAssets) && !p.slice(ownAssets.length).includes('/'))
      const others = this.referencedBy((e) => e !== entry)
      if (images.length) await mkdir(await this.abs(joinRel(folder, ASSETS_DIR)), { recursive: true })
      for (const src of images) {
        const srcAbs = await this.abs(src)
        if (!(await exists(srcAbs))) continue
        const dstAbs = await this.abs(joinRel(folder, `${ASSETS_DIR}/${src.slice(ownAssets.length)}`))
        if (await exists(dstAbs)) continue
        // 다른 메모도 쓰는 이미지는 옮기지 않고 복사한다
        if (others.has(src)) await copyFile(srcAbs, dstAbs)
        else await rename(srcAbs, dstAbs)
      }

      const base = rel.slice(from ? from.length + 1 : 0).replace(/\.md$/, '')
      const target = await uniqueMdPath(folder, base, this.relExists)
      await rename(await this.abs(rel), await this.abs(target))
      await this.index.refresh(rel)
      await this.index.refresh(target)
      return this.index.meta(this.index.active.get(target)!)
    })
  }

  /**
   * 휴지통으로 옮긴다. 이미지는 그대로 둔다 — 복원하면 그대로 보여야 하므로 (§3.4).
   * 휴지통 안의 경로를 돌려준다 — 같은 이름이 이미 있으면 `(2)` 가 붙어 원래 경로와 다르다.
   */
  remove(id: string): Promise<{ trashPath: string }> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const rel = this.requirePath(id)
      const folder = folderOf(rel)
      const base = rel.slice(folder ? folder.length + 1 : 0).replace(/\.md$/, '')
      // 최상위 메모는 `.trash/` 바로 아래로 — joinRel(TRASH_DIR, '') 은 `.trash/` 가 되어 빗금이 겹친다
      const trashRel = await uniqueMdPath(folder ? joinRel(TRASH_DIR, folder) : TRASH_DIR, base, this.relExists)
      await mkdir(await this.abs(folderOf(trashRel)), { recursive: true })
      const target = await this.abs(trashRel)
      await rename(await this.abs(rel), target)
      // 휴지통에 들어온 시각을 mtime 으로 남긴다 — rename 은 mtime 을 바꾸지 않는다
      const now = new Date()
      await utimes(target, now, now)
      const trashPath = trashRel.slice(TRASH_DIR.length + 1)
      await this.index.refresh(rel)
      await this.index.refresh(trashPath, 'trash')
      return { trashPath }
    })
  }

  trashList(): Promise<TrashItem[]> {
    return this.exclusive(async () => {
      await this.index.rescan()
      return [...this.index.trash.values()]
        .map((e) => ({ path: e.path, title: this.index.meta(e).title, trashedAt: nowKst(new Date(e.mtimeMs)) }))
        .sort((a, b) => b.trashedAt.localeCompare(a.trashedAt))
    })
  }

  restore(trashPath: string): Promise<MemoMeta> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const entry = this.index.trash.get(trashPath)
      if (!entry) throw new MemoError('not_found', '휴지통에 없는 메모입니다')
      const folder = folderOf(trashPath)
      assertFolder(folder)
      await mkdir(await this.abs(folder), { recursive: true })
      const base = trashPath.slice(folder ? folder.length + 1 : 0).replace(/\.md$/, '')
      const target = await uniqueMdPath(folder, base, this.relExists)
      await rename(await this.abs(joinRel(TRASH_DIR, trashPath)), await this.abs(target))
      await this.index.refresh(trashPath, 'trash')
      await this.index.refresh(target)
      return this.index.meta(this.index.active.get(target)!)
    })
  }

  /** 휴지통을 비우고, 이제 아무도 참조하지 않는 이미지를 지운다 */
  emptyTrash(): Promise<{ memos: number; images: number }> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memos = this.index.trash.size
      await rm(await this.abs(TRASH_DIR), { recursive: true, force: true })
      await mkdir(await this.abs(TRASH_DIR), { recursive: true })
      await this.index.rescan()
      return { memos, images: await this.removeUnreferencedImages() }
    })
  }

  /**
   * 휴지통에 들어간 지 {@link TRASH_RETENTION_DAYS}일이 지난 메모를 지운다 (서버 플러그인이 하루 한 번).
   * 들어간 시각 = mtime. 앱 밖에서 `.trash/` 로 옮긴 파일은 마지막 수정 시각이 기준이라 더 일찍 지워질 수 있다.
   * 지운 뒤 아무도 참조하지 않게 된 이미지와 빈 폴더도 정리한다.
   */
  purgeTrash(now = Date.now()): Promise<{ memos: number; images: number }> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const cutoff = now - TRASH_RETENTION_DAYS * DAY_MS
      const expired = [...this.index.trash.entries()].filter(([, e]) => e.mtimeMs < cutoff).map(([rel]) => rel)
      if (!expired.length) return { memos: 0, images: 0 }
      for (const rel of expired) await rm(await this.abs(joinRel(TRASH_DIR, rel)), { force: true })
      await this.removeEmptyDirs(TRASH_DIR)
      await this.index.rescan()
      return { memos: expired.length, images: await this.removeUnreferencedImages() }
    })
  }

  /** 어떤 메모(활성 + 휴지통)도 참조하지 않는 `assets/` 이미지를 지운다. 지운 수 */
  private async removeUnreferencedImages() {
    const referenced = this.referencedBy(() => true)
    let images = 0
    for (const assetsRel of await this.assetDirs(this.root, '')) {
      for (const e of await readdir(await this.abs(assetsRel), { withFileTypes: true })) {
        if (!e.isFile()) continue
        const rel = `${assetsRel}/${e.name}`
        if (referenced.has(rel)) continue
        await rm(await this.abs(rel))
        images++
      }
    }
    return images
  }

  /** rel 아래의 빈 폴더를 지운다 (rel 자체는 남긴다) */
  private async removeEmptyDirs(rel: string) {
    for (const e of await readdir(await this.abs(rel), { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const child = joinRel(rel, e.name)
      await this.removeEmptyDirs(child)
      if (!(await readdir(await this.abs(child))).length) await rm(await this.abs(child), { recursive: true })
    }
  }

  /** 메모들(활성 + 휴지통)이 참조하는 이미지 경로. 휴지통 항목은 원래 폴더 기준으로 푼다 */
  private referencedBy(include: (entry: IndexEntry) => boolean) {
    const out = new Set<string>()
    for (const entry of [...this.index.active.values(), ...this.index.trash.values()]) {
      if (!include(entry)) continue
      for (const p of referencedImages(folderOf(entry.path), entry.body)) out.add(p)
    }
    return out
  }

  private async assetDirs(dir: string, prefix: string): Promise<string[]> {
    const out: string[] = []
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const rel = joinRel(prefix, e.name)
      if (e.name === ASSETS_DIR) out.push(rel)
      else out.push(...(await this.assetDirs(join(dir, e.name), rel)))
    }
    return out
  }

  // ── 폴더 ────────────────────────────────────────────────────────────

  createFolder(parent: string, name: string): Promise<{ path: string }> {
    return this.exclusive(async () => {
      await this.requireFolder(parent)
      assertName(name)
      const path = joinRel(parent, name)
      if (await this.relExists(path)) throw new MemoError('conflict', '같은 이름의 폴더가 이미 있습니다')
      await mkdir(await this.abs(path))
      return { path }
    })
  }

  renameFolder(path: string, name: string): Promise<{ path: string }> {
    return this.exclusive(async () => {
      if (!path) throw new MemoError('bad_request', '최상위 폴더는 이름을 바꿀 수 없습니다')
      await this.requireFolder(path)
      assertName(name)
      const next = joinRel(folderOf(path), name)
      if (next === path) return { path }
      if (await this.relExists(next)) throw new MemoError('conflict', '같은 이름의 폴더가 이미 있습니다')
      await rename(await this.abs(path), await this.abs(next))
      await this.index.rescan()
      return { path: next }
    })
  }

  /**
   * 폴더를 다른 폴더 안으로(또는 최상위로) 옮긴다. 안의 메모·assets/ 가 통째로 따라가므로 폴더 안의
   * 상대경로 이미지 참조는 그대로 맞는다. 자기 자신이나 자기 하위 폴더 안으로는 못 옮긴다.
   */
  moveFolder(path: string, parent: string): Promise<{ path: string }> {
    return this.exclusive(async () => {
      if (!path) throw new MemoError('bad_request', '최상위 폴더는 옮길 수 없습니다')
      await this.requireFolder(path)
      await this.requireFolder(parent)
      if (parent === path || parent.startsWith(`${path}/`)) {
        throw new MemoError('bad_request', '폴더를 자기 자신이나 하위 폴더 안으로 옮길 수 없습니다')
      }
      const name = path.slice(path.lastIndexOf('/') + 1)
      const next = joinRel(parent, name)
      if (next === path) return { path }
      if (await this.relExists(next)) throw new MemoError('conflict', `「${parent || '최상위'}」 에 같은 이름의 폴더가 이미 있습니다`)
      await rename(await this.abs(path), await this.abs(next))
      await this.index.rescan()
      return { path: next }
    })
  }

  /** 메모가 하나도 없고, 남은 이미지를 아무도 참조하지 않을 때만 지운다 (§3.4) */
  deleteFolder(path: string): Promise<void> {
    return this.exclusive(async () => {
      if (!path) throw new MemoError('bad_request', '최상위 폴더는 지울 수 없습니다')
      await this.requireFolder(path)
      await this.index.rescan()
      const prefix = `${path}/`
      if ([...this.index.active.keys()].some((rel) => rel.startsWith(prefix))) {
        throw new MemoError('conflict', '폴더에 메모가 남아 있습니다')
      }
      const referenced = this.referencedBy(() => true)
      if ([...referenced].some((p) => p.startsWith(prefix))) {
        throw new MemoError('conflict', '이 폴더의 이미지를 다른 메모(휴지통 포함)가 쓰고 있습니다')
      }
      await rm(await this.abs(path), { recursive: true })
    })
  }

  // ── 이미지 ──────────────────────────────────────────────────────────

  /** 메모 폴더의 `assets/` 에 이미지를 쓴다. 돌려주는 src 를 본문에 그대로 넣는다 */
  saveImage(id: string, bytes: Uint8Array): Promise<{ src: string }> {
    return this.exclusive(async () => {
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new MemoError('too_large', '이미지는 10MB 까지입니다')
      const ext = sniffImage(bytes)
      if (!ext) throw new MemoError('unsupported_type', 'jpeg, png, gif, webp 만 올릴 수 있습니다')
      await this.index.rescan()
      const folder = folderOf(this.requirePath(id))
      const name = `${ulid()}.${ext}`
      await mkdir(await this.abs(joinRel(folder, ASSETS_DIR)), { recursive: true })
      await writeAtomic(await this.abs(joinRel(folder, `${ASSETS_DIR}/${name}`)), bytes)
      return { src: `${ASSETS_DIR}/${name}` }
    })
  }

  /** 화면이 여는 이미지. `…/assets/<파일>` 꼴의 이미지 파일만 내준다 — 메모 원문이나 휴지통은 이 길로 안 나간다 */
  async imageFile(rel: string) {
    const segments = rel.split('/')
    const name = segments.at(-1) ?? ''
    const ext = extOf(name)
    if (segments.length < 2 || segments.at(-2) !== ASSETS_DIR || !ext || segments.some((s) => !s || s.startsWith('.'))) {
      throw new MemoError('not_found', '이미지를 찾을 수 없습니다')
    }
    const abs = await this.abs(rel)
    const s = await stat(abs).catch(() => null)
    if (!s?.isFile()) throw new MemoError('not_found', '이미지를 찾을 수 없습니다')
    return { abs, type: IMAGE_TYPES[ext], size: s.size }
  }
}
