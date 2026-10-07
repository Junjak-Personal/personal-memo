/**
 * 메모리 인덱스와 stat 재스캔 (설계문서 §5).
 *
 * 파일 감시는 쓰지 않는다. 요청 직전에 전체를 stat 해서 mtime·크기가 바뀐 파일만 다시 읽는다.
 * vim 으로 고친 것도 다음 요청에서 그대로 보인다.
 */
import type { Stats } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoMeta } from '../../shared/types/memo'
import { isDateString } from '../../shared/utils/memo-date'
import { isUlid } from '../../shared/utils/ulid'
import { type MemoFields, parseMemo } from './file'
import { ASSETS_DIR, TRASH_DIR, folderOf } from './paths'

export interface IndexEntry {
  /** `memos/` 기준 경로. 휴지통 항목은 `.trash/` 를 뗀 «원래» 경로 */
  path: string
  mtimeMs: number
  size: number
  fields: MemoFields
  body: string
  unreadable: boolean
}

const NO_FIELDS: MemoFields = { id: null, title: null, created: null, updated: null, date: null, dateEnd: null, tags: [], done: null }

/** `.md` 파일의 상대경로들. 점으로 시작하는 것(휴지통·임시 파일)·`assets`·심볼릭 링크는 건너뛴다 */
export async function walkMarkdown(dir: string, prefix = ''): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (e.name !== ASSETS_DIR) out.push(...(await walkMarkdown(join(dir, e.name), rel)))
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(rel)
    }
  }
  return out
}

function entryFrom(path: string, raw: string, s: Stats): IndexEntry {
  const parsed = parseMemo(raw)
  return parsed.ok
    ? { path, mtimeMs: s.mtimeMs, size: s.size, fields: parsed.fields, body: parsed.body, unreadable: false }
    : { path, mtimeMs: s.mtimeMs, size: s.size, fields: NO_FIELDS, body: parsed.body, unreadable: true }
}

export class MemoIndex {
  /** 활성 메모. key = 상대경로 */
  readonly active = new Map<string, IndexEntry>()
  /** 휴지통. key = `.trash` 기준 상대경로 */
  readonly trash = new Map<string, IndexEntry>()
  private readonly idToPath = new Map<string, string>()

  constructor(private readonly root: string) {}

  async rescan() {
    await this.sync(this.root, this.active)
    await this.sync(join(this.root, TRASH_DIR), this.trash)
    this.rebuildIds()
  }

  /** 앱이 방금 쓰거나 옮긴 파일 하나를 바로 반영한다. 없어졌으면 뺀다 */
  async refresh(rel: string, where: 'active' | 'trash' = 'active') {
    const map = where === 'active' ? this.active : this.trash
    const abs = where === 'active' ? join(this.root, rel) : join(this.root, TRASH_DIR, rel)
    try {
      const s = await stat(abs)
      map.set(rel, entryFrom(rel, await readFile(abs, 'utf8'), s))
    } catch {
      map.delete(rel)
    }
    this.rebuildIds()
  }

  private async sync(dir: string, map: Map<string, IndexEntry>) {
    const files = await walkMarkdown(dir)
    const seen = new Set(files)
    await Promise.all(
      files.map(async (rel) => {
        let s: Stats
        let raw: string
        try {
          s = await stat(join(dir, rel))
          const prev = map.get(rel)
          if (prev && prev.mtimeMs === s.mtimeMs && prev.size === s.size) return
          raw = await readFile(join(dir, rel), 'utf8')
        } catch {
          // 스캔 도중 사라진 파일
          seen.delete(rel)
          return
        }
        map.set(rel, entryFrom(rel, raw, s))
      }),
    )
    for (const key of [...map.keys()]) if (!seen.has(key)) map.delete(key)
  }

  /**
   * id → 경로. 같은 id 를 가진 파일이 둘이면(밖에서 cp 로 복사) 하나만 그 id 를 갖고,
   * 나머지는 경로 id(`p:`)로 다룬다. 앱에서 저장하는 순간 새 id 를 받는다.
   *
   * 🔴 누가 id 를 갖는지를 경로 순서로 정하면 안 된다. `원본 사본.md` 가 `원본.md` 보다 앞서 정렬돼
   *    복사본이 원본의 id 를 빼앗고, 원본의 주소와 구글 일정 연결이 복사본으로 넘어간다 (테스트로 잡았다).
   *    그래서 이미 그 id 를 갖고 있던 파일이 계속 갖는다. 처음 보는 경우엔 mtime 이 오래된 쪽이 갖는다 —
   *    복사본은 보통 복사한 시각을 mtime 으로 갖는다.
   */
  private rebuildIds() {
    const previous = new Map(this.idToPath)
    this.idToPath.clear()
    for (const [id, rel] of previous) {
      if (this.active.get(rel)?.fields.id === id) this.idToPath.set(id, rel)
    }
    const rest = [...this.active.values()].sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
    for (const entry of rest) {
      const id = entry.fields.id
      if (id && isUlid(id) && !this.idToPath.has(id)) this.idToPath.set(id, entry.path)
    }
  }

  idOf(entry: IndexEntry) {
    const id = entry.fields.id
    return id && this.idToPath.get(id) === entry.path ? id : `p:${entry.path}`
  }

  pathOf(id: string) {
    if (id.startsWith('p:')) {
      const rel = id.slice(2)
      const entry = this.active.get(rel)
      return entry && this.idOf(entry) === id ? rel : null
    }
    return this.idToPath.get(id) ?? null
  }

  meta(entry: IndexEntry): MemoMeta {
    const { fields } = entry
    const fileTitle = entry.path.slice(entry.path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    const date = fields.date && isDateString(fields.date) ? fields.date : null
    const dateEnd = date && fields.dateEnd && isDateString(fields.dateEnd) && fields.dateEnd > date ? fields.dateEnd : null
    return {
      id: this.idOf(entry),
      path: entry.path,
      folder: folderOf(entry.path),
      title: fields.title ?? fileTitle,
      created: fields.created,
      updated: fields.updated,
      date,
      dateEnd,
      tags: fields.tags,
      done: fields.done,
      unreadable: entry.unreadable,
    }
  }
}
