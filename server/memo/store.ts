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
  FolderOrder,
  Memo,
  MemoMeta,
  PublicMemo,
  SearchHit,
  TrashItem,
  TreeResponse,
  UpdateMemoInput,
} from '../../shared/types/memo'
import { isRelativeSrc, normalizePath } from '../../shared/utils/asset-path'
import { isDateString, kstDay, nowKst } from '../../shared/utils/memo-date'
import { hasTag, parseSearchQuery } from '../../shared/utils/tags'
import { isScheduled } from '../../shared/utils/todo'
import { DAY_MS, TRASH_RETENTION_DAYS } from '../../shared/utils/trash'
import { isUlid, ulid } from '../../shared/utils/ulid'
import { extractMemoLinkIds } from '../../shared/utils/memo-links'
import { MemoError } from './errors'
import { parseMemo, serializeMemo, versionOf } from './file'
import { exists, writeAtomic } from './fsx'
import { downloadNameOf, extOf, IMAGE_TYPES, isOriginalName, MAX_IMAGE_BYTES, MAX_ORIGINAL_BYTES, referencedImages, sniffImage, stemOf } from './images'
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
import { EMPTY_ORDER_FILE, ORDER_FILE, type OrderFile, parseOrderFile, serializeOrderFile } from './order'
import { type IndexEntry, MemoIndex } from './scan'
import { MemoHistory } from './history'
import type { MemoRevision, MemoRevisionSummary } from '../../shared/types/memo-history'
import { withStableMemoId } from './links'
import { MemoTemplates } from './templates'
import type { MemoTemplate, MemoTemplateSummary } from '../../shared/types/memo-templates'

const SNIPPET_RADIUS = 40

export class MemoStore {
  private readonly index: MemoIndex
  private readonly templates: MemoTemplates
  private readonly history: MemoHistory
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly root: string) {
    this.index = new MemoIndex(root)
    this.history = new MemoHistory(root)
    this.templates = new MemoTemplates(root)
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

  templateList(): Promise<MemoTemplateSummary[]> {
    return this.exclusive(() => this.templates.list())
  }

  getTemplate(id: string): Promise<MemoTemplate> {
    return this.exclusive(() => this.templates.get(id))
  }

  saveTemplate(memoId: string, name: string, baseVersion: string): Promise<MemoTemplateSummary> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memo = await this.read(this.requirePath(memoId))
      if (memo.unreadable) throw new MemoError('unreadable', '읽을 수 없는 메모는 템플릿으로 저장할 수 없습니다')
      if (memo.version !== baseVersion) throw new MemoError('conflict', '메모가 다른 곳에서 수정되었습니다', { version: memo.version })
      return this.templates.save(memo, name)
    })
  }

  renameTemplate(id: string, name: string): Promise<MemoTemplateSummary> {
    return this.exclusive(() => this.templates.rename(id, name))
  }

  removeTemplate(id: string): Promise<void> {
    return this.exclusive(() => this.templates.remove(id))
  }

  createFromTemplate(id: string, folder: string): Promise<Memo> {
    return this.exclusive(async () => {
      await this.requireFolder(folder)
      await this.index.rescan()
      const snapshot = await this.templates.instantiate(id, folder)
      let published = false
      try {
        const now = nowKst()
        const rel = await uniqueMdPath(folder, fileBaseFromTitle(snapshot.title), this.relExists)
        const raw = serializeMemo(null, { id: ulid(), title: snapshot.title, created: now, updated: now, date: null, dateEnd: null, tags: snapshot.tags, done: null, public: false }, snapshot.content)
        await writeAtomic(await this.abs(rel), raw)
        published = true
        await this.index.refresh(rel)
        return await this.read(rel)
      } catch (error) { if (!published) await snapshot.cleanup(); throw error }
    })
  }

  // ── 읽기 ────────────────────────────────────────────────────────────

  tree(): Promise<TreeResponse> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memos = [...this.index.active.values()].map((e) => this.index.meta(e))
      memos.sort((a, b) => a.path.localeCompare(b.path, 'ko'))
      const folders = await this.folderTree(this.root, '')
      const root = await this.readOrder('')
      const orders: Record<string, FolderOrder> = {}
      for (const path of ['', ...folderPaths(folders)]) {
        const order = path ? await this.readOrder(path) : root
        if (order.folders.length || order.memos.length) orders[path] = { folders: order.folders, memos: order.memos }
      }
      return { folders, memos, orders, todoOrder: root.todos }
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

  /** 백링크는 인증된 활성 원문에서만 계산한다. 휴지통·읽기 불가 문서의 메타를 내보내지 않는다. */
  backlinks(id: string): Promise<MemoMeta[]> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const target = this.index.active.get(this.requirePath(id))!
      if (target.unreadable) throw new MemoError('unreadable', '읽을 수 없는 메모의 연결은 열 수 없습니다')
      return [...this.index.active.values()]
        .filter(entry => !entry.unreadable && entry !== target && extractMemoLinkIds(entry.body).has(id))
        .map(entry => this.index.meta(entry))
        .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || a.title.localeCompare(b.title, 'ko') || a.path.localeCompare(b.path, 'ko'))
    })
  }

  /** 사용자가 선택한 외부 파일에만 안정 ID를 준다. 제목·경로·본문·수정 시각을 바꾸지 않는다. */
  ensureLinkTarget(id: string): Promise<MemoMeta> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const rel = this.requirePath(id)
      const entry = this.index.active.get(rel)!
      if (entry.unreadable) throw new MemoError('unreadable', '읽을 수 없는 메모는 연결할 수 없습니다')
      if (!id.startsWith('p:')) return this.index.meta(entry)
      const abs = await this.abs(rel)
      const raw = await readFile(abs, 'utf8')
      await writeAtomic(abs, withStableMemoId(raw, ulid()))
      await this.index.refresh(rel)
      return this.index.meta(this.index.active.get(rel)!)
    })
  }

  /** 제목 + 본문. `#` 으로 시작하는 낱말은 태그로 거른다 (`#업무 회의` = 업무 태그 중 「회의」가 든 것) */
  search(query: string): Promise<SearchHit[]> {
    return this.exclusive(async () => {
      const { tags, text } = parseSearchQuery(query)
      const q = text.toLowerCase()
      if (!q && !tags.length) return []
      await this.index.rescan()
      const hits: SearchHit[] = []
      for (const entry of this.index.active.values()) {
        const meta = this.index.meta(entry)
        if (!tags.every((t) => hasTag(meta.tags, t))) continue
        const inTitle = q !== '' && meta.title.toLowerCase().includes(q)
        const at = q ? entry.body.toLowerCase().indexOf(q) : -1
        if (q && !inTitle && at === -1) continue
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
        // 끝난 할 일은 일정이 아니다 — 「이날 만든 메모」에는 남는다
        if (isScheduled(meta) && meta.date <= to && (meta.dateEnd ?? meta.date) >= from) scheduled.push(meta)
      }
      return { created, scheduled }
    })
  }

  /**
   * 구글 캘린더 대조용 (§8.3) — 메모 파일 수(휴지통 포함)와, id 가 있고 일정으로 보이는(날짜 있음 + 끝나지 않음) 활성 메모.
   * total 이 0 이면 대조가 «데이터 폴더가 빠졌다»고 보고 삭제를 미룬다. 휴지통을 세는 이유 — 하나뿐인 메모를
   * 휴지통에 넣었을 때 그 일정까지 막히지 않게 (폴더가 정말 빠졌다면 휴지통도 비어 있다).
   * `p:` 경로 id 는 빠진다. 파일 이름이 바뀌면 id 도 바뀌어 일정이 끊기므로, 앱에서 한 번 저장해 id 가 붙은 뒤부터 잇는다.
   */
  calendarSnapshot(): Promise<{ total: number; memos: MemoMeta[] }> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memos = [...this.index.active.values()]
        .map((e) => this.index.meta(e))
        .filter((m) => isScheduled(m) && !m.id.startsWith('p:'))
      return { total: this.index.active.size + this.index.trash.size, memos }
    })
  }

  // ── 외부 공개 (§11.2) — 로그인 없이 부른다 ─────────────────────────────

  /** 공개된 메모의 제목·본문. 없는 메모와 공개하지 않은 메모는 똑같이 «없음» — 비공개 메모가 있는지도 알리지 않는다 */
  publicMemo(id: string): Promise<PublicMemo> {
    return this.exclusive(async () => {
      const entry = await this.publicEntry(id)
      const meta = this.index.meta(entry)
      return { title: meta.title, content: entry.body, updated: meta.updated }
    })
  }

  /**
   * 공개된 메모가 본문에서 참조하는 이미지. 화면은 본문 속 경로(src)를 그대로 보내고, 그 메모가 실제로 참조하는 것만 내준다 —
   * 같은 `assets/` 의 다른 이미지나 원본(`.orig`)은 이 길로 나가지 않는다.
   */
  publicImage(id: string, src: string) {
    return this.exclusive(async () => {
      const entry = await this.publicEntry(id)
      const folder = folderOf(entry.path)
      const refs = referencedImages(folder, entry.body)
      const candidates = [src]
      try {
        candidates.push(decodeURI(src))
      } catch {
        // 잘못된 % 인코딩 — 적힌 그대로만 본다
      }
      for (const candidate of candidates) {
        if (!isRelativeSrc(candidate)) continue
        const path = normalizePath(folder ? `${folder}/${candidate}` : candidate)
        if (path && refs.has(path)) return this.imageFile(path)
      }
      throw new MemoError('not_found', '이미지를 찾을 수 없습니다')
    })
  }

  /** 경로 id(`p:`)는 공개 주소로 쓰지 않는다 — setPublic 이 막지만, 밖에서 `public: true` 를 적은 id 없는 파일도 여기서 막힌다 */
  private async publicEntry(id: string) {
    // 로그인 없이 오는 요청이다 — id 꼴이 아니면 전체 재스캔까지 가지 않는다
    if (!isUlid(id)) throw new MemoError('not_found', '공개된 메모가 없습니다')
    await this.index.rescan()
    const rel = this.index.pathOf(id)
    const entry = rel ? this.index.active.get(rel) : undefined
    if (!entry || entry.unreadable || !entry.fields.public) throw new MemoError('not_found', '공개된 메모가 없습니다')
    return entry
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
        { id: ulid(), title: input.title, created: now, updated: now, date: input.date, dateEnd: input.dateEnd, tags: input.tags ?? [], done: input.done ?? null, public: false },
        input.content,
      )
      await writeAtomic(await this.abs(rel), raw)
      await this.index.refresh(rel)
      return this.read(rel)
    })
  }

  update(id: string, input: UpdateMemoInput): Promise<Memo> {
    return this.exclusive(() => this.updateUnlocked(id, input))
  }

  /** restore도 같은 저장·충돌·이름 변경 경로를 쓴다. 호출자는 exclusive를 잡고 있어야 한다. */
  private async updateUnlocked(id: string, input: UpdateMemoInput, skipCapture = false): Promise<Memo> {
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
    const nextId = keepId ? parsed.fields.id! : ulid()
    if (!skipCapture) {
      const meta = this.index.meta(this.index.active.get(rel)!)
      await this.history.capture(nextId, {
        title: meta.title,
        content: parsed.body, date: meta.date, dateEnd: meta.dateEnd, tags: meta.tags,
      }, folderOf(rel))
    }
    const now = nowKst()
    const next = serializeMemo(
      parsed.doc,
      {
        id: nextId,
        title: input.title,
        created: parsed.fields.created ?? now,
        updated: now,
        date: input.date,
        dateEnd: input.dateEnd,
        tags: input.tags ?? parsed.fields.tags,
        // 할 일 체크·외부 공개는 저장 입력에 없다 — 파일의 값을 그대로 둔다 (버전도 done·public 을 빼고 잰다)
        done: parsed.fields.done,
        public: parsed.fields.public,
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
  }

  getRevisions(id: string): Promise<MemoRevisionSummary[]> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memo = await this.read(this.requirePath(id))
      if (memo.unreadable) throw new MemoError('unreadable', '읽을 수 없는 메모의 수정 이력은 열 수 없습니다')
      return this.history.list(id)
    })
  }

  getRevision(id: string, revision: string): Promise<MemoRevision> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memo = await this.read(this.requirePath(id))
      if (memo.unreadable) throw new MemoError('unreadable', '읽을 수 없는 메모의 수정 이력은 열 수 없습니다')
      return this.history.get(id, revision)
    })
  }

  restoreRevision(id: string, revision: string, baseVersion: string): Promise<Memo> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const memo = await this.read(this.requirePath(id))
      if (memo.version !== baseVersion) throw new MemoError('conflict', '다른 곳에서 먼저 수정했습니다', { version: memo.version })
      if (memo.unreadable) throw new MemoError('unreadable', '읽을 수 없는 메모는 복원할 수 없습니다')
      // 선택한 버전 존재/보관 기간부터 확인한다. 잘못된 요청은 이력을 만들지 않는다.
      await this.history.get(id, revision)
      // 보관 상한에 걸린 가장 오래된 선택 버전도 먼저 읽어 둔다. 이후 보관 정리가 선택을 지울 수 있다.
      const input = await this.history.restoreInput(id, revision, memo.folder)
      await this.history.capture(id, memo, memo.folder, true)
      return this.updateUnlocked(id, { ...input, baseVersion }, true)
    })
  }

  /**
   * 할 일 체크 — frontmatter 의 `done` 만 바꾼다 (null = 할 일 해제, 키 삭제). 본문·updated·제목은 그대로다.
   * 버전을 받지 않는다: 버전은 done 줄을 빼고 재므로 이 변경은 누구의 저장과도 부딪히지 않는다.
   */
  setDone(id: string, done: boolean | null): Promise<MemoMeta> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const rel = this.requirePath(id)
      const abs = await this.abs(rel)
      const raw = await readFile(abs, 'utf8')
      const parsed = parseMemo(raw)
      if (!parsed.ok) {
        throw new MemoError('unreadable', 'frontmatter 를 읽을 수 없어 바꾸지 않았습니다. 파일을 직접 고쳐 주세요')
      }
      if (parsed.fields.done !== done) {
        await writeAtomic(abs, serializeMemo(parsed.doc, { ...parsed.fields, done }, parsed.body))
        await this.index.refresh(rel)
      }
      return this.index.meta(this.index.active.get(rel)!)
    })
  }

  /**
   * 외부 공개 켜기·끄기 (§11.2) — frontmatter 의 `public` 만 바꾼다. setDone 처럼 버전을 받지 않는다(버전은 public 줄을 빼고 잰다).
   * 공개 주소가 메모 id(`/ext/{id}`)라서, id 가 없는 파일(경로 id `p:`)은 주소에 폴더·파일 이름이 드러나므로 켜지 않는다 —
   * 앱에서 한 번 저장하면 id 가 붙는다. 끄기는 언제나 된다.
   */
  setPublic(id: string, value: boolean): Promise<MemoMeta> {
    return this.exclusive(async () => {
      await this.index.rescan()
      const rel = this.requirePath(id)
      if (value && id.startsWith('p:')) throw new MemoError('bad_request', '앱에서 한 번 저장한 메모만 공개할 수 있습니다')
      const abs = await this.abs(rel)
      const raw = await readFile(abs, 'utf8')
      const parsed = parseMemo(raw)
      if (!parsed.ok) {
        throw new MemoError('unreadable', 'frontmatter 를 읽을 수 없어 바꾸지 않았습니다. 파일을 직접 고쳐 주세요')
      }
      if (parsed.fields.public !== value) {
        await writeAtomic(abs, serializeMemo(parsed.doc, { ...parsed.fields, public: value }, parsed.body))
        await this.index.refresh(rel)
      }
      return this.index.meta(this.index.active.get(rel)!)
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
      // 원본(`<이름>.orig.<ext>`)은 화면 이미지를 따라간다
      const originals = images.length ? await this.originalsIn(joinRel(from, ASSETS_DIR)) : new Map<string, string>()
      for (const src of images) {
        const shared = others.has(src)
        const original = originals.get(stemOf(src))
        for (const file of original ? [src, original] : [src]) {
          const srcAbs = await this.abs(file)
          if (!(await exists(srcAbs))) continue
          const dstAbs = await this.abs(joinRel(folder, `${ASSETS_DIR}/${file.slice(ownAssets.length)}`))
          if (await exists(dstAbs)) continue
          // 다른 메모도 쓰는 이미지는 옮기지 않고 복사한다
          if (shared) await copyFile(srcAbs, dstAbs)
          else await rename(srcAbs, dstAbs)
        }
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
      const removedIds = this.historyIds(this.index.trash.values())
      await rm(await this.abs(TRASH_DIR), { recursive: true, force: true })
      await mkdir(await this.abs(TRASH_DIR), { recursive: true })
      await this.index.rescan()
      await this.removeDeletedHistory(removedIds)
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
      const removedIds = this.historyIds(expired.map((rel) => this.index.trash.get(rel)!))
      for (const rel of expired) await rm(await this.abs(joinRel(TRASH_DIR, rel)), { force: true })
      await this.removeEmptyDirs(TRASH_DIR)
      await this.index.rescan()
      await this.removeDeletedHistory(removedIds)
      return { memos: expired.length, images: await this.removeUnreferencedImages() }
    })
  }

  private historyIds(entries: Iterable<IndexEntry>) {
    const out = new Set<string>()
    for (const entry of entries) {
      out.add(this.index.meta(entry).id)
      // 같은 ID로 외부에서 복사한 파일은 p:로 보이더라도 살아 있는 원본 이력을 보호한다.
      if (entry.fields.id && isUlid(entry.fields.id)) out.add(entry.fields.id)
    }
    return out
  }

  private async removeDeletedHistory(removedIds: Set<string>) {
    const remaining = this.historyIds([...this.index.active.values(), ...this.index.trash.values()])
    for (const id of removedIds) if (!remaining.has(id)) await this.history.remove(id)
  }

  /** 휴지통과 같은 기존 하루 정리 훅을 사용한다. capture/restore와 동시에 실행되지 않는다. */
  purgeHistory(now = Date.now()): Promise<number> {
    return this.exclusive(async () => (await this.history.purgeExpired(now)) + (await this.templates.purgeStaging(now)))
  }

  /** 어떤 메모(활성 + 휴지통)도 참조하지 않는 `assets/` 이미지를 지운다. 지운 수 */
  private async removeUnreferencedImages() {
    const referenced = this.referencedBy(() => true)
    // 원본은 본문이 참조하지 않는다 — 그 화면 이미지가 참조되는 동안 남긴다
    const keptStems = new Set([...referenced].map(stemOf))
    let images = 0
    for (const assetsRel of await this.assetDirs(this.root, '')) {
      for (const e of await readdir(await this.abs(assetsRel), { withFileTypes: true })) {
        if (!e.isFile()) continue
        const rel = `${assetsRel}/${e.name}`
        if (referenced.has(rel)) continue
        if (isOriginalName(e.name) && keptStems.has(stemOf(rel))) continue
        await rm(await this.abs(rel))
        images++
      }
    }
    return images
  }

  /** `assets/` 폴더 안의 원본들 — stem(확장자 뗀 경로) → 원본 경로 */
  private async originalsIn(assetsRel: string) {
    const out = new Map<string, string>()
    const entries = await readdir(await this.abs(assetsRel), { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isFile() || !isOriginalName(e.name)) continue
      const rel = `${assetsRel}/${e.name}`
      out.set(stemOf(rel), rel)
    }
    return out
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
      // GC/공유 이미지 보존은 모호한 코드 참조까지 남긴다. 공개 허용 목록은 기본 strict 검사다.
      for (const p of referencedImages(folderOf(entry.path), entry.body, true)) out.add(p)
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

  // ── 순서 (§3.6) ─────────────────────────────────────────────────────

  private async readOrder(folder: string): Promise<OrderFile> {
    const raw = await readFile(join(await this.abs(folder), ORDER_FILE), 'utf8').catch(() => null)
    return raw === null ? { ...EMPTY_ORDER_FILE } : parseOrderFile(raw)
  }

  private async writeOrder(folder: string, order: OrderFile) {
    await writeAtomic(join(await this.abs(folder), ORDER_FILE), serializeOrderFile(order))
  }

  /** 폴더 안의 순서 — 하위 폴더 이름, 메모 id. 넘긴 쪽만 바꾼다 */
  setOrder(folder: string, patch: Partial<FolderOrder>): Promise<FolderOrder> {
    return this.exclusive(async () => {
      await this.requireFolder(folder)
      const order = await this.readOrder(folder)
      const next = { ...order, ...patch }
      await this.writeOrder(folder, next)
      return { folders: next.folders, memos: next.memos }
    })
  }

  /** 「할 일」 화면의 순서 — 최상위 순서 파일의 todos */
  setTodoOrder(ids: string[]): Promise<string[]> {
    return this.exclusive(async () => {
      const order = await this.readOrder('')
      await this.writeOrder('', { ...order, todos: ids })
      return ids
    })
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
      // 이름이 바뀌어도 위 폴더 안의 자리는 그대로 — 순서에 적힌 이름을 바꾼다
      const parent = folderOf(path)
      const order = await this.readOrder(parent)
      const oldName = path.slice(path.lastIndexOf('/') + 1)
      if (order.folders.includes(oldName)) {
        await this.writeOrder(parent, { ...order, folders: order.folders.map((n) => (n === oldName ? name : n)) })
      }
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
  /**
   * original — 화면용으로 줄이기 전의 원본 (있을 때만). 같은 이름에 `.orig` 를 붙여 옆에 둔다.
   * 원본은 백업하지 않는다(§12) — 이 서버 디스크에만 있다.
   */
  saveImage(id: string, bytes: Uint8Array, original?: Uint8Array): Promise<{ src: string; original: boolean }> {
    return this.exclusive(async () => {
      if (bytes.byteLength > MAX_IMAGE_BYTES) throw new MemoError('too_large', '이미지는 10MB 까지입니다')
      const ext = sniffImage(bytes)
      if (!ext) throw new MemoError('unsupported_type', 'jpeg, png, gif, webp 만 올릴 수 있습니다')
      let originalExt = null
      if (original) {
        if (original.byteLength > MAX_ORIGINAL_BYTES) throw new MemoError('too_large', '원본은 30MB 까지입니다')
        originalExt = sniffImage(original)
        if (!originalExt) throw new MemoError('unsupported_type', '원본은 jpeg, png, gif, webp 만 보관할 수 있습니다')
      }
      await this.index.rescan()
      const folder = folderOf(this.requirePath(id))
      const name = ulid()
      await mkdir(await this.abs(joinRel(folder, ASSETS_DIR)), { recursive: true })
      await writeAtomic(await this.abs(joinRel(folder, `${ASSETS_DIR}/${name}.${ext}`)), bytes)
      if (original && originalExt) await writeAtomic(await this.abs(joinRel(folder, `${ASSETS_DIR}/${name}.orig.${originalExt}`)), original)
      return { src: `${ASSETS_DIR}/${name}.${ext}`, original: !!original }
    })
  }

  /**
   * 화면 이미지(`…/assets/<ulid>.<ext>`)의 원본. 원본을 따로 두지 않은 이미지(줄이지 않고 올린 것)는 화면 이미지가 곧 원본이다.
   * stored — 원본 파일이 따로 있었나 (다른 폴더로 붙여넣을 때 원본도 같이 옮길지 판단)
   */
  async originalImageFile(displayRel: string) {
    const display = await this.imageFile(displayRel)
    const dir = displayRel.slice(0, displayRel.lastIndexOf('/'))
    const original = (await this.originalsIn(dir)).get(stemOf(displayRel))
    return original
      ? { ...(await this.imageFile(original)), stored: true, name: downloadNameOf(original) }
      : { ...display, stored: false, name: downloadNameOf(displayRel) }
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

function folderPaths(nodes: FolderNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...folderPaths(n.children)])
}
