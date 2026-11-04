import { Extension, Node } from '@tiptap/core'
import type { MarkdownToken } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { NodeSelection, Selection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { memoLinkHref, memoLinkId } from '#shared/utils/memo-links'
import { tableUsesHtml } from './editor-table'

export type MemoColumnCount = 2 | 3 | 4

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    memoColumns: {
      setMemoColumns: (count: MemoColumnCount) => ReturnType
      unsetMemoColumns: () => ReturnType
    }
  }
}

/** HTML 속성과 ProseMirror 속성은 외부 입력이다. 지원하는 단 수만 모델로 들인다. */
export function memoColumnCount(value: unknown): MemoColumnCount | null {
  if (value === 2 || value === '2') return 2
  if (value === 3 || value === '3') return 3
  if (value === 4 || value === '4') return 4
  return null
}

/** div HTML은 빈 줄에서 잘릴 수 있다. 코드 블록의 빈 줄까지 포함해 그룹 하나를 토큰으로 읽는다. */
export function tokenizeMemoColumns(source: string): MarkdownToken | undefined {
  if (!/^ {0,3}<div\b[^>]*\bdata-memo-columns\s*=\s*(["'])[234]\1(?:\s[^>]*|)>/i.test(source)) return undefined
  const tags = /<!--[\s\S]*?-->|<\/?div\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi
  let depth = 0
  for (const tag of source.matchAll(tags)) {
    if (tag[0].startsWith('<!--')) continue
    depth += /^<\/div/i.test(tag[0]) ? -1 : 1
    if (depth !== 0) continue
    const raw = source.slice(0, tag.index + tag[0].length)
    // 기본 HTML 핸들러가 등록된 Tiptap 스키마의 parseHTML로 안전하게 읽게 한다.
    return { type: 'html', raw, text: raw, block: true }
  }
  return undefined
}

function activeColumns(tr: Transaction) {
  const { selection } = tr
  if (selection instanceof NodeSelection && selection.node.type.name === 'memoColumns') {
    return { node: selection.node, pos: selection.from }
  }
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    const node = selection.$from.node(depth)
    if (node.type.name === 'memoColumns') return { node, pos: selection.$from.before(depth) }
  }
  return null
}

function hasColumns(node: ProseMirrorNode) {
  let found = node.type.name === 'memoColumns'
  node.descendants(child => {
    if (child.type.name === 'memoColumns') found = true
    return !found
  })
  return found
}

/** 실제 명령과 DOM 없는 모델 회귀 검사가 같은 변환을 사용한다. dispatch가 없으면 tr을 건드리지 않는다. */
export function setMemoColumnsTransaction(tr: Transaction, count: number, apply = true): boolean {
  const supported = memoColumnCount(count)
  const groupType = tr.doc.type.schema.nodes.memoColumns
  const columnType = tr.doc.type.schema.nodes.memoColumn
  if (!supported || !groupType || !columnType) return false
  const current = activeColumns(tr)
  if (current) {
    if (tr.selection.to > current.pos + current.node.nodeSize) return false
    if (current.node.childCount === supported && current.node.attrs.count === supported) return true
    const columns: ProseMirrorNode[] = []
    current.node.forEach(column => columns.push(column))
    if (columns.length > supported) {
      const last = columns[supported - 1]!
      let content = last.content
      for (const removed of columns.slice(supported)) content = content.append(removed.content)
      columns.splice(supported - 1, columns.length, columnType.create(null, content))
    }
    while (columns.length < supported) {
      const empty = columnType.createAndFill()
      if (!empty) return false
      columns.push(empty)
    }
    if (apply) {
      closeHistory(tr)
      tr.replaceWith(current.pos, current.pos + current.node.nodeSize, groupType.create({ count: supported }, columns))
      tr.setSelection(Selection.near(tr.doc.resolve(current.pos + 2)))
    }
    return true
  }

  const startIndex = Math.min(tr.selection.$from.index(0), tr.doc.childCount - 1)
  const endAtBoundary = !tr.selection.empty && tr.selection.$to.depth === 0
  const endIndex = Math.min(tr.selection.$to.index(0) - (endAtBoundary ? 1 : 0), tr.doc.childCount - 1)
  const blocks: ProseMirrorNode[] = []
  let from = 0
  let to = 0
  tr.doc.forEach((node, pos, index) => {
    if (index < startIndex || index > endIndex) return
    if (!blocks.length) from = pos
    blocks.push(node)
    to = pos + node.nodeSize
  })
  if (!blocks.length || blocks.some(hasColumns)) return false
  const columns = [columnType.create(null, Fragment.fromArray(blocks))]
  for (let index = 1; index < supported; index++) {
    const empty = columnType.createAndFill()
    if (!empty) return false
    columns.push(empty)
  }
  if (apply) {
    closeHistory(tr)
    tr.replaceWith(from, to, groupType.create({ count: supported }, columns))
    tr.setSelection(Selection.near(tr.doc.resolve(from + 2)))
  }
  return true
}

export function unsetMemoColumnsTransaction(tr: Transaction, apply = true): boolean {
  const current = activeColumns(tr)
  if (!current || tr.selection.to > current.pos + current.node.nodeSize) return false
  let content = Fragment.empty
  current.node.forEach(column => { content = content.append(column.content) })
  if (apply) {
    closeHistory(tr)
    tr.replaceWith(current.pos, current.pos + current.node.nodeSize, content)
    tr.setSelection(Selection.near(tr.doc.resolve(current.pos)))
  }
  return true
}

/** 화면의 이미지 URL·표 레이아웃·비공개 최신 제목을 저장 HTML에 섞지 않는다. */
export function memoColumnsSerializer(schema: Schema) {
  const base = DOMSerializer.fromSchema(schema)
  const serializer = new DOMSerializer({ ...base.nodes }, { ...base.marks })
  const image = serializer.nodes.image
  if (image) {
    serializer.nodes.image = node => {
      const spec = image(node)
      if (Array.isArray(spec) && spec[0] === 'img' && typeof spec[1] === 'object' && spec[1] !== null) {
        return ['img', { ...spec[1], src: node.attrs.src }]
      }
      return spec
    }
  }
  if (serializer.nodes.table) {
    serializer.nodes.table = node => ['table', { 'data-memo-table': tableUsesHtml(node.toJSON()) ? 'html' : 'markdown' }, ['tbody', 0]]
  }
  if (serializer.nodes.memoReference) {
    serializer.nodes.memoReference = node => {
      const id = typeof node.attrs.id === 'string' ? node.attrs.id : ''
      const label = typeof node.attrs.label === 'string' ? node.attrs.label : ''
      if (!memoLinkId(`/m/${id}`)) return ['span', {}, label]
      const title = typeof node.attrs.linkTitle === 'string' ? { title: node.attrs.linkTitle } : {}
      return ['a', { href: memoLinkHref(id), ...title }, label]
    }
  }
  return serializer
}

export function memoColumnsKit() {
  let schema: Schema | null = null
  const MemoColumn = Node.create({
    name: 'memoColumn',
    content: 'block+',
    defining: true,
    isolating: true,
    parseHTML() {
      return [{ tag: 'div[data-memo-column]', getAttrs: element => element.parentElement?.matches('div[data-memo-columns]') ? {} : false }]
    },
    renderHTML() { return ['div', { 'data-memo-column': '' }, 0] },
  })
  const MemoColumns = Node.create({
    name: 'memoColumns',
    group: 'block',
    content: 'memoColumn{2,4}',
    defining: true,
    isolating: true,
    addAttributes() {
      return { count: { default: 2, rendered: false, parseHTML: element => memoColumnCount(element.getAttribute('data-memo-columns')) ?? 2 } }
    },
    onBeforeCreate() { schema = this.editor.schema },
    parseHTML() {
      return [{
        tag: 'div[data-memo-columns]',
        getAttrs: element => {
          const count = memoColumnCount(element.getAttribute('data-memo-columns'))
          if (!count || element.parentElement?.closest('[data-memo-columns]')) return false
          const children = [...element.children]
          return children.length === count && children.every(child => child.matches('div[data-memo-column]')) ? { count } : false
        },
      }]
    },
    renderHTML({ node }) {
      return ['div', { 'data-memo-columns': memoColumnCount(node.attrs.count) ?? memoColumnCount(node.childCount) ?? 2 }, 0]
    },
    markdownTokenizer: { name: 'memoColumnsHtml', level: 'block', start: source => source.search(/<div\b[^>]*\bdata-memo-columns\s*=/i), tokenize: tokenizeMemoColumns },
    renderMarkdown(node) {
      if (!schema) throw new Error('다단 직렬화에 필요한 스키마가 없습니다')
      const element = memoColumnsSerializer(schema).serializeNode(schema.nodeFromJSON(node))
      const wrapper = document.createElement('div')
      wrapper.append(element)
      return wrapper.innerHTML
    },
    addCommands() {
      return {
        setMemoColumns: count => ({ tr, dispatch }) => setMemoColumnsTransaction(tr, count, !!dispatch),
        unsetMemoColumns: () => ({ tr, dispatch }) => unsetMemoColumnsTransaction(tr, !!dispatch),
      }
    },
  })
  return Extension.create({ name: 'memoColumnsKit', addExtensions: () => [MemoColumns, MemoColumn] })
}
