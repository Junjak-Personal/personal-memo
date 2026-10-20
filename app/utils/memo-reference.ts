import { Node } from '@tiptap/core'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { watchEffect } from 'vue'
import { memoLinkHref, memoLinkId } from '#shared/utils/memo-links'

export interface MemoReferenceOptions {
  interactive: boolean
  title: (id: string, fallback: string) => string
  onOpen: (id: string) => void
}

function escapedLabel(label: string) {
  return label.replace(/[\r\n]+/g, ' ').replace(/([\\[\]`*_!<>])/g, '\\$1')
}

interface ReferenceToken extends MarkdownToken {
  type: 'memoReference'
  raw: string
  id: string
  labelSource: string
  destinationSource: string
  linkTitle: string | null
}

/** 표준 Markdown의 내부 링크만 자른다. 외부 링크·이미지·코드는 기존 lexer가 처리한다. */
export function tokenizeMemoReference(source: string): ReferenceToken | undefined {
  if (source[0] !== '[') return undefined
  let depth = 1
  let end = -1
  for (let index = 1; index < source.length && index <= 4096; index++) {
    if (source[index] === '\\') { index++; continue }
    if (source[index] === '\r' || source[index] === '\n') return undefined
    if (source[index] === '`') {
      let next = index + 1
      while (source[next] === '`') next++
      const close = source.indexOf(source.slice(index, next), next)
      if (close !== -1) { index = close + next - index - 1; continue }
    }
    if (source[index] === '[') depth++
    else if (source[index] === ']') {
      depth--
      if (depth === 0) { end = index; break }
    }
  }
  if (end === -1) return undefined
  const destination = /^\(\s*(?:<([^<>\r\n]*)>|([^\s()]+))(?:\s+(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)'|\(((?:\\.|[^)\\\r\n])*)\)))?\s*\)/.exec(source.slice(end + 1))
  if (!destination) return undefined
  const href = destination[1] ?? destination[2]
  const id = memoLinkId(href)
  if (!id) return undefined
  const title = destination[3] ?? destination[4] ?? destination[5]
  return {
    type: 'memoReference', raw: source.slice(0, end + 1 + destination[0].length), id,
    labelSource: source.slice(1, end), destinationSource: destination[0].slice(1, -1),
    linkTitle: title === undefined ? null : title.replace(/\\(.)/g, '$1'),
  }
}

function plainText(nodes: JSONContent[]): string {
  return nodes.map(node => node.text ?? (node.type === 'memoReference' ? nodeLabel(node) : plainText(node.content ?? []))).join('')
}

function nodeLabel(node: ProseMirrorNode | JSONContent) {
  return typeof node.attrs?.label === 'string' ? node.attrs.label : '제목 없음'
}

/** 공개 화면은 기본 설정으로 비활성 텍스트만 그린다. 최신 비공개 제목도 조회하지 않는다. */
export const MemoReference = Node.create<MemoReferenceOptions>({
  name: 'memoReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,
  addOptions() {
    return { interactive: false, title: (_id, fallback) => fallback, onOpen: () => {} }
  },
  addAttributes() {
    return {
      id: { default: null, rendered: false },
      label: { default: '', rendered: false },
      // 원래 링크의 굵게/escape 등은 저장 시 그대로 되돌린다. UI 제목 갱신과 문서 변경을 분리한다.
      labelSource: { default: null, rendered: false },
      destinationSource: { default: null, rendered: false },
      linkTitle: { default: null, rendered: false },
    }
  },
  parseHTML() {
    return [{
      tag: 'a[href]',
      priority: 100,
      getAttrs: element => {
        const id = memoLinkId(element.getAttribute('href'))
        const title = element.getAttribute('title')
        return id ? {
          id, label: element.textContent ?? '', labelSource: null, linkTitle: title,
          destinationSource: title ? `${memoLinkHref(id)} "${title.replace(/[\r\n]+/g, ' ').replace(/([\\"])/g, '\\$1')}"` : null,
        } : false
      },
    }]
  },
  renderHTML({ node }) {
    const label = nodeLabel(node)
    const id = typeof node.attrs.id === 'string' ? node.attrs.id : ''
    if (!this.options.interactive || !memoLinkId(`/m/${id}`)) return ['span', { class: 'memo-reference-text' }, label]
    return ['a', { href: memoLinkHref(id), class: 'memo-reference', 'data-memo-reference': id, ...(typeof node.attrs.linkTitle === 'string' ? { title: node.attrs.linkTitle } : {}) }, label]
  },
  renderText({ node }) { return nodeLabel(node) },
  markdownTokenizer: {
    name: 'memoReference',
    level: 'inline',
    start: source => source.indexOf('['),
    tokenize: source => tokenizeMemoReference(source),
  },
  parseMarkdown(token, helpers) {
    const id = typeof token.id === 'string' ? token.id : ''
    const labelSource = typeof token.labelSource === 'string' ? token.labelSource : ''
    const children = helpers.tokenizeInline ? helpers.parseInline(helpers.tokenizeInline(labelSource)) : []
    return helpers.createNode('memoReference', {
      id, label: plainText(children) || labelSource.replace(/\\(.)/g, '$1'), labelSource,
      destinationSource: typeof token.destinationSource === 'string' ? token.destinationSource : null,
      linkTitle: typeof token.linkTitle === 'string' ? token.linkTitle : null,
    })
  },
  renderMarkdown(node) {
    const id = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
    const source = typeof node.attrs?.labelSource === 'string' ? node.attrs.labelSource : escapedLabel(nodeLabel(node))
    // labelSource는 parser가 하나의 label로 검증한 것만 그대로 사용한다. JSON/클립보드 조작은 다시 escape한다.
    const canonical = memoLinkHref(id)
    const candidate = typeof node.attrs?.destinationSource === 'string' ? node.attrs.destinationSource : canonical
    const sourceText = `[${source}](${candidate})`
    const test = tokenizeMemoReference(sourceText)
    if (test?.raw === sourceText && test.id === id) return sourceText
    return `[${escapedLabel(nodeLabel(node))}](${canonical})`
  },
  addNodeView() {
    return ({ node: initial }) => {
      let current = initial
      const element = document.createElement(this.options.interactive ? 'a' : 'span')
      element.contentEditable = 'false'
      element.draggable = false
      element.className = this.options.interactive ? 'memo-reference' : 'memo-reference-text'
      const render = () => {
        const id = typeof current.attrs.id === 'string' ? current.attrs.id : ''
        const label = nodeLabel(current)
        element.textContent = this.options.interactive ? this.options.title(id, label) : label
        if (element instanceof HTMLAnchorElement && memoLinkId(`/m/${id}`)) {
          element.setAttribute('href', memoLinkHref(id))
          element.setAttribute('aria-label', `${element.textContent} 메모 열기`)
        }
      }
      // tree 제목 변경은 문서 transaction 밖의 사건이다. 화면 글자만 갱신해 자동저장을 만들지 않는다.
      const stop = watchEffect(render, { flush: 'sync' })
      const onClick = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        const id = typeof current.attrs.id === 'string' ? current.attrs.id : ''
        if (this.options.interactive && memoLinkId(`/m/${id}`)) this.options.onOpen(id)
      }
      if (this.options.interactive) element.addEventListener('click', onClick)
      return {
        dom: element,
        update: next => {
          if (next.type !== current.type) return false
          current = next
          render()
          return true
        },
        stopEvent: event => this.options.interactive && event.type === 'click',
        ignoreMutation: () => true,
        destroy: () => { stop(); element.removeEventListener('click', onClick) },
      }
    }
  },
})

export interface MemoReferenceQuery { from: number; to: number; query: string }

/** 실제 textblock의 커서 앞 [[만 받는다. 코드·선택 영역·escaped/image 형태는 제안하지 않는다. */
export function memoReferenceQuery(state: EditorState): MemoReferenceQuery | null {
  const { selection } = state
  const { $from } = selection
  if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.spec.code || $from.marks().some(mark => mark.type.name === 'code')) return null
  const text = $from.parent.textBetween(0, $from.parentOffset, '\n', '\uFFFC')
  const start = text.lastIndexOf('[[')
  if (start < 0 || text[start - 1] === '!') return null
  let slashes = 0
  for (let index = start - 1; index >= 0 && text[index] === '\\'; index--) slashes++
  if (slashes % 2) return null
  const tail = text.slice(start + 2)
  const query = tail.endsWith(']]') ? tail.slice(0, -2) : tail
  if (query.length > 200 || /[\]\r\n\uFFFC]/.test(query)) return null
  return { from: $from.start() + start, to: selection.from, query: query.trim() }
}

export interface MemoReferenceContext {
  query: MemoReferenceQuery
  doc: ProseMirrorNode
  scope: string
}

export function memoReferenceContext(state: EditorState, scope: string | null): MemoReferenceContext | null {
  const query = memoReferenceQuery(state)
  return scope && query ? { query, doc: state.doc, scope } : null
}

export function currentMemoReferenceContext(context: MemoReferenceContext, state: EditorState, scope: string | null) {
  const query = memoReferenceQuery(state)
  return scope === context.scope && state.doc.eq(context.doc) && query?.from === context.query.from && query.to === context.query.to && query.query === context.query.query
}

export async function insertMemoReferenceSafely(options: {
  alive: () => boolean
  state: () => EditorState
  scope: () => string | null
  flush: () => Promise<boolean>
  prepare: () => Promise<{ id: string; title: string }>
  insert: (tr: Transaction) => void
}): Promise<'inserted' | 'changed' | 'save-failed'> {
  if (!options.alive()) return 'changed'
  const context = memoReferenceContext(options.state(), options.scope())
  if (!context) return 'changed'
  const valid = () => options.alive() && currentMemoReferenceContext(context, options.state(), options.scope())
  const saved = await options.flush()
  if (!valid()) return 'changed'
  if (!saved) return 'save-failed'
  const target = await options.prepare()
  if (!valid()) return 'changed'
  const state = options.state()
  const type = state.schema.nodes.memoReference
  if (!type || !memoLinkId(memoLinkHref(target.id))) return 'changed'
  const tr = state.tr.replaceWith(context.query.from, context.query.to, type.create({ id: target.id, label: target.title, labelSource: null }))
  tr.setSelection(TextSelection.near(tr.doc.resolve(context.query.from + 1)))
  options.insert(tr)
  return 'inserted'
}
