/**
 * 메모 파일 = frontmatter(YAML) + 본문 (설계문서 §3.1).
 *
 * 다른 도구(vim, Obsidian)도 이 파일을 고친다. 그래서:
 * - 앱이 모르는 키(`aliases` …)와 주석은 지우지 않는다 — YAML 을 값이 아니라 문서(Document)로 다룬다.
 * - `tags` 는 앱도 쓴다. 바뀌었을 때만 고쳐 쓴다 — 밖에서 쓴 모양(`tags: a, b`, 블록 목록)은 그대로 남는다.
 * - `done`(할 일)도 바뀌었을 때만 쓴다. `true`/`false` 가 아닌 값은 모르는 값으로 두고 건드리지 않는다.
 * - frontmatter 를 읽지 못하면 그 파일은 «앱에서 저장하지 않는다». 고쳐 쓰다가 남의 내용을 날리는 것보다
 *   저장을 거부하는 편이 낫다.
 */
import { createHash } from 'node:crypto'
import { Document, isMap, isSeq, parseDocument } from 'yaml'
import { cleanTags, sameTags } from '../../shared/utils/tags'

export interface MemoFields {
  id: string | null
  title: string | null
  created: string | null
  updated: string | null
  date: string | null
  dateEnd: string | null
  /** 없으면 빈 배열 */
  tags: string[]
  /** 할 일 — null = 메모 (`done` 키가 없거나 true/false 가 아님) */
  done: boolean | null
}

export type ParsedMemo =
  | { ok: true; doc: Document | null; fields: MemoFields; body: string }
  | { ok: false; body: string }

const EMPTY: MemoFields = { id: null, title: null, created: null, updated: null, date: null, dateEnd: null, tags: [], done: null }

/** 맨 앞의 `---` … `---` 블록. 비어 있는 frontmatter(`---\n---`)도 받는다 */
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/

/** YAML 이 숫자·불리언으로 읽은 제목(`title: 123`)도 문자열로 되돌린다 */
function text(value: unknown) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/**
 * `tags: [a, b]` · 블록 목록 · `tags: a, b`(문자열) 모두 받는다. 밖에서 쓴 파일이라 너그럽게 읽는다.
 * YAML 이 컬렉션은 노드로 돌려주므로 값으로 바꿔서 본다.
 */
function tagsOf(value: unknown) {
  const raw = isSeq(value) ? value.toJSON() : value
  if (Array.isArray(raw)) return cleanTags(raw.flatMap((v) => text(v) ?? []))
  if (typeof raw === 'string') return cleanTags(raw.split(/[,\s]+/))
  return []
}

/** `done: true` / `done: false` 만 할 일이다. 밖에서 쓴 `done: yes` 같은 값은 메모로 본다 */
function doneOf(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

export function parseMemo(raw: string): ParsedMemo {
  const match = FRONTMATTER.exec(raw)
  if (!match) return { ok: true, doc: null, fields: { ...EMPTY }, body: raw }

  // 본문 앞의 빈 줄 하나는 frontmatter 와의 구분이다 — 쓸 때 다시 붙인다
  const body = raw.slice(match[0].length).replace(/^\r?\n/, '')
  const yamlText = match[1] ?? ''
  const doc = parseDocument(yamlText)
  if (doc.errors.length || (doc.contents !== null && !isMap(doc.contents))) return { ok: false, body }

  return {
    ok: true,
    doc,
    fields: {
      id: text(doc.get('id')),
      title: text(doc.get('title')),
      created: text(doc.get('created')),
      updated: text(doc.get('updated')),
      date: text(doc.get('date')),
      dateEnd: text(doc.get('date_end')),
      tags: tagsOf(doc.get('tags')),
      done: doneOf(doc.get('done')),
    },
    body,
  }
}

/**
 * 아는 키만 고치고 나머지는 그대로 둔 채 파일 내용을 만든다.
 * 이미 있는 키는 제자리에서 바뀌고(순서 유지), 없던 키는 아래 순서로 뒤에 붙는다.
 */
export function serializeMemo(doc: Document | null, fields: MemoFields, body: string) {
  const target = doc ?? new Document({})
  const pairs: [string, string | null][] = [
    ['id', fields.id],
    ['title', fields.title],
    ['created', fields.created],
    ['updated', fields.updated],
    ['date', fields.date],
    ['date_end', fields.dateEnd],
  ]
  for (const [key, value] of pairs) {
    if (value === null) target.delete(key)
    else target.set(key, value)
  }
  // 태그는 바뀌었을 때만 쓴다. 새로 쓸 때는 한 줄 목록(`tags: [업무, 회의]`)
  if (!sameTags(tagsOf(target.get('tags')), fields.tags)) {
    if (fields.tags.length) target.set('tags', target.createNode(fields.tags, { flow: true }))
    else target.delete('tags')
  }
  // 할 일도 바뀌었을 때만. 모르는 값(`done: yes`)은 null 로 읽혀 «같음» 이 되므로 그대로 남는다
  if (doneOf(target.get('done')) !== fields.done) {
    if (fields.done === null) target.delete('done')
    else target.set('done', fields.done)
  }
  // 한 줄 목록은 손으로 쓰는 모양(`[a, b]`)으로 — 기본값은 `[ a, b ]` 라 저장할 때마다 사람이 쓴 목록까지 바뀐다
  const yaml = target.toString({ lineWidth: 0, flowCollectionPadding: false })
  const content = body.endsWith('\n') ? body : `${body}\n`
  return `---\n${yaml}---\n\n${content}`
}

/** frontmatter 안의 `done:` 줄 (맨 앞에서 시작하는 최상위 키만) */
const DONE_LINE = /^done:[^\r\n]*(?:\r?\n|$)/m

/**
 * 파일 내용 해시 — 저장 충돌 판정용 (설계문서 §3.3).
 * frontmatter 의 `done:` 줄은 뺀다. 할 일 체크는 편집기가 들고 있는 내용이 아니고 수정 저장은 파일의 값을 그대로 두므로,
 * 목록에서 체크했다고 열린 편집기의 다음 저장이 「다른 곳에서 먼저 수정했습니다」로 막히면 안 된다.
 */
export function versionOf(raw: string) {
  const match = FRONTMATTER.exec(raw)
  const text = match ? match[0].replace(DONE_LINE, '') + raw.slice(match[0].length) : raw
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}
