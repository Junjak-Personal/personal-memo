import { createRequire } from 'node:module'
import { getExtensionField, getSchema } from '@tiptap/core'
import type { JSONContent, NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { DOMSerializer, Schema } from '@tiptap/pm/model'
import type { Mark } from '@tiptap/pm/model'
import { DecorationSet } from '@tiptap/pm/view'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { publicMemoHref } from './public-memo-links'
import {
  MemoReference,
  currentMemoReferenceContext,
  insertMemoReferenceSafely,
  memoReferenceContext,
  memoReferenceQuery,
  tokenizeMemoReference,
} from './memo-reference'

const require = createRequire(import.meta.resolve('@nuxt/ui'))
const { MarkdownManager } = require('@tiptap/markdown')
const { StarterKit } = require('@tiptap/starter-kit')
const A = '01K7ZY4YF8GSF5H4JEH2R2DW4C'
const B = '01K7ZY4YF8GSF5H4JEH2R2DW4D'
const href = `/m/${A}`

function manager() { return new MarkdownManager({ extensions: [StarterKit, Image, MemoReference] }) }
function references(doc: JSONContent): JSONContent[] {
  return [...(doc.type === 'memoReference' ? [doc] : []), ...(doc.content ?? []).flatMap(references)]
}

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { content: 'inline*', group: 'block' },
  heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
  codeBlock: { content: 'text*', group: 'block', code: true },
  memoReference: { inline: true, group: 'inline', atom: true, attrs: { id: {}, label: {}, labelSource: { default: null } } },
}, marks: { code: { code: true } } })

function state(text: string, type = 'paragraph', marks: readonly Mark[] = []) {
  const node = schema.node(type, null, text ? schema.text(text, marks) : undefined)
  const doc = schema.node('doc', null, node)
  return EditorState.create({ doc, selection: TextSelection.create(doc, text.length + 1) })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('표준 Markdown 메모 참조 노드', () => {
  it('메모 경로만 토큰화하고 외부/경로 ID/이미지/쿼리는 기존 lexer에 남긴다', () => {
    expect(tokenizeMemoReference(`[대상](${href}) 뒤`)).toMatchObject({ type: 'memoReference', raw: `[대상](${href})`, id: A, labelSource: '대상' })
    for (const source of [`[외부](https://example.com/m/${A})`, '[경로](/m/p%3A외부.md)', `[쿼리](${href}?a=b)`, `[해시](${href}#x)`, `[악성](javascript:alert(1))`, `![이미지](${href})`]) {
      expect(tokenizeMemoReference(source)).toBeUndefined()
    }
  })

  it('직렬화는 표준 링크이며 escaped/rich label을 왕복할 때 바꾸지 않는다', () => {
    const md = manager()
    for (const source of [`[대상](${href})`, `[A \\] B](${href})`, `[**굵게** &amp; 보통](${href})`, `[괄호 \\[메모\\]](${href})`, `[대상 [중첩]](${href} "설명")`, `[대상](<${href}> '작은 설명')`, `[대상](${href} (설명))`, `[\`닫힘 ] 문자\`](${href})`]) {
      const doc = md.parse(source) as JSONContent
      expect(references(doc)).toHaveLength(1)
      expect(md.serialize(doc)).toBe(source)
    }
    expect(references(md.parse(`[**굵게**](${href})`))[0]!.attrs?.label).toBe('굵게')
  })

  it('기존 외부 링크·이미지·inline/fenced code의 읽기·출력과 동일하다', () => {
    const old = new MarkdownManager({ extensions: [StarterKit, Image] })
    const md = manager()
    for (const source of ['[외부](https://example.com)', '![사진](assets/photo.png)', `\`[메모](${href})\``, `\`\`\`md\n[메모](${href})\n\`\`\``, `\\[메모](${href})`]) {
      expect(md.parse(source)).toEqual(old.parse(source))
      expect(md.serialize(md.parse(source))).toBe(old.serialize(old.parse(source)))
    }
  })

  it('만든 노드는 제목의 Markdown 특수문자를 escape해 링크 범위를 탈출하지 않는다', () => {
    const md = manager()
    const node: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'memoReference', attrs: { id: A, label: '메모 ](/m/다른것) **강조**', labelSource: null } }] }] }
    const text = md.serialize(node) as string
    const restored = references(md.parse(text))[0]!
    expect(references(md.parse(text))).toHaveLength(1)
    expect(restored.attrs?.id).toBe(A)
    expect(restored.attrs?.label).toBe('메모 ](/m/다른것) **강조**')
  })

  it('공개 HTML은 private 제목 callback·ID·href 없이 저장 fallback 텍스트만 내보낸다', () => {
    const lookup = vi.fn(() => '비공개 최신 제목')
    const publicSchema = getSchema([StarterKit, MemoReference.configure({ title: lookup })])
    const node = publicSchema.node('memoReference', { id: A, label: '공개한 설명' })
    const spec = DOMSerializer.fromSchema(publicSchema).nodes.memoReference!(node)
    expect(spec).toEqual(['span', { class: 'memo-reference-text' }, '공개한 설명'])
    expect(JSON.stringify(spec)).not.toContain(A)
    expect(lookup).not.toHaveBeenCalled()
    const privateSchema = getSchema([StarterKit, MemoReference.configure({ interactive: true })])
    const privateSpec = DOMSerializer.fromSchema(privateSchema).nodes.memoReference!(privateSchema.node('memoReference', { id: A, label: '설명' }))
    expect(privateSpec).toEqual(['a', { href, class: 'memo-reference', 'data-memo-reference': A }, '설명'])
  })

  it('공개 대상만 공개 주소로 연결하고 저장된 label·title과 Markdown 원문을 유지한다', () => {
    const lookup = vi.fn(() => '비공개 최신 제목')
    const extension = MemoReference.configure({ publicHref: (id: string) => id === A ? `/ext/${A}` : null, title: lookup })
    const publicSchema = getSchema([StarterKit, extension])
    const serializer = DOMSerializer.fromSchema(publicSchema).nodes.memoReference!
    expect(serializer(publicSchema.node('memoReference', { id: A, label: '경력 기술서', linkTitle: '상세 설명' })))
      .toEqual(['a', { href: `/ext/${A}`, class: 'memo-reference', title: '상세 설명' }, '경력 기술서'])
    expect(serializer(publicSchema.node('memoReference', { id: B, label: '원문 설명' })))
      .toEqual(['span', { class: 'memo-reference-text' }, '원문 설명'])
    expect(lookup).not.toHaveBeenCalled()
    const md = new MarkdownManager({ extensions: [StarterKit, extension] })
    const source = `[경력 기술서](${href} "상세 설명")`
    expect(md.serialize(md.parse(source))).toBe(source)
  })

  it('공개 callback이 편집·외부·스크립트 주소를 반환해도 공개 참조에 넣지 않는다', () => {
    for (const address of [href, `https://evil.example/ext/${A}`, 'javascript:alert(1)', `/ext/${B}`]) {
      const publicSchema = getSchema([StarterKit, MemoReference.configure({ publicHref: () => address })])
      const result = DOMSerializer.fromSchema(publicSchema).nodes.memoReference!(publicSchema.node('memoReference', { id: A, label: '원문' }))
      expect(result).toEqual(['span', { class: 'memo-reference-text' }, '원문'])
    }
  })

  it('이력서 형태의 텍스트 링크는 공개 대상 세 개만 연결하고 외부 링크도 보존한다', () => {
    const C = '01K7ZY4YF8GSF5H4JEH2R2DW4E'
    const tree = { memos: [{ id: A, title: '경력 기술서' }, { id: B, title: '사이드 프로젝트' }], folders: [{
      id: 'public-folder', name: '포트폴리오', children: [], memos: [{ id: C, title: '실무 프로젝트' }],
    }] }
    const extension = MemoReference.configure({ publicHref: id => publicMemoHref(tree, id) })
    const md = new MarkdownManager({ extensions: [StarterKit, extension] })
    const source = `상세 내용은 [경력 기술서](/m/${A})에서 확인합니다.\n\n- [사이드 프로젝트](/m/${B})\n- [실무 프로젝트](/m/${C})\n- [블로그](https://example.com)`
    const parsed = md.parse(source) as JSONContent
    const publicSchema = getSchema([StarterKit, extension])
    const serializer = DOMSerializer.fromSchema(publicSchema)
    const links = references(parsed).map(node => serializer.nodes.memoReference!(publicSchema.nodeFromJSON(node)))
    expect(links).toEqual([
      ['a', { href: `/ext/${A}`, class: 'memo-reference' }, '경력 기술서'],
      ['a', { href: `/ext/${B}`, class: 'memo-reference' }, '사이드 프로젝트'],
      ['a', { href: `/ext/${C}`, class: 'memo-reference' }, '실무 프로젝트'],
    ])
    expect(md.serialize(parsed)).toBe(source)
    const external = serializer.marks.link!(publicSchema.mark('link', { href: 'https://example.com' }), true)
    expect(external).toEqual(expect.arrayContaining(['a', expect.objectContaining({ href: 'https://example.com' })]))
  })

  it('옵션 title과 중첩 label을 가진 표준 내부 링크도 공개 화면에서 비활성화한다', () => {
    const md = manager()
    const publicSchema = getSchema([StarterKit, MemoReference])
    for (const source of [`[대상](${href} "설명")`, `[대상 [중첩]](${href})`]) {
      const parsed = md.parse(source) as JSONContent
      const refNode = references(parsed)[0]!
      expect(references(parsed)).toHaveLength(1)
      const node = publicSchema.nodeFromJSON(refNode)
      const spec = DOMSerializer.fromSchema(publicSchema).nodes.memoReference!(node)
      if (!Array.isArray(spec)) throw new Error('내부 참조의 DOM spec이 배열이어야 합니다')
      expect(spec[0]).toBe('span')
      expect(JSON.stringify(spec)).not.toContain(href)
      expect(JSON.stringify(spec)).not.toContain(A)
      expect(md.serialize(parsed)).toBe(source)
    }
  })

  it('공개 NodeView는 목록 도착·공개 해제를 반영하고 편집용 callback을 호출하지 않는다', () => {
    class PublicAnchor {
      textContent: string | null = ''
      contentEditable = ''
      draggable = true
      className = ''
      attributes = new Map<string, string>()
      listeners = new Map<string, EventListener>()
      setAttribute(name: string, value: string) { this.attributes.set(name, value) }
      removeAttribute(name: string) { this.attributes.delete(name) }
      addEventListener(type: string, callback: EventListener) { this.listeners.set(type, callback) }
      removeEventListener(type: string) { this.listeners.delete(type) }
    }
    vi.stubGlobal('document', { createElement: () => new PublicAnchor() })
    vi.stubGlobal('HTMLAnchorElement', PublicAnchor)
    try {
      const published = ref(false)
      const onOpen = vi.fn()
      const title = vi.fn(() => '비공개 최신 제목')
      const extension = MemoReference.configure({ publicHref: id => published.value ? `/ext/${id}` : null, onOpen, title })
      const factory = getExtensionField<() => NodeViewRenderer>(extension, 'addNodeView', { options: extension.options })
      const node = getSchema([StarterKit, extension]).node('memoReference', { id: A, label: '공개한 설명' })
      const view = factory()({ node } as unknown as NodeViewRendererProps)
      const dom = view.dom as unknown as PublicAnchor
      expect(dom.attributes.has('href')).toBe(false)
      published.value = true
      expect(dom.attributes.get('href')).toBe(`/ext/${A}`)
      expect(dom.className).toBe('memo-reference')
      expect(dom.textContent).toBe('공개한 설명')
      expect(dom.listeners.has('click')).toBe(false)
      expect(onOpen).not.toHaveBeenCalled()
      expect(title).not.toHaveBeenCalled()
      published.value = false
      expect(dom.attributes.has('href')).toBe(false)
      expect(dom.className).toBe('memo-reference-text')
      expect(node.attrs.label).toBe('공개한 설명')
      view.destroy?.()
      published.value = true
      expect(dom.attributes.has('href')).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  it('nodeview는 최신 제목만 반영하며 문서 속성은 유지하고 종료 뒤 watcher를 정리한다', () => {
    class FakeElement {
      textContent: string | null = ''
      contentEditable = ''
      draggable = true
      className = ''
      attributes = new Map<string, string>()
      listeners = new Map<string, EventListener>()
      setAttribute(name: string, value: string) { this.attributes.set(name, value) }
      removeAttribute(name: string) { this.attributes.delete(name) }
      addEventListener(type: string, callback: EventListener) { this.listeners.set(type, callback) }
      removeEventListener(type: string) { this.listeners.delete(type) }
    }
    class FakeAnchor extends FakeElement {}
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'a' ? new FakeAnchor() : new FakeElement() })
    vi.stubGlobal('HTMLAnchorElement', FakeAnchor)
    try {
      const titles = ref<Record<string, string>>({ [A]: '처음 제목' })
      const onOpen = vi.fn()
      const extension = MemoReference.configure({ interactive: true, title: (id, fallback) => titles.value[id] ?? fallback, onOpen })
      const factory = getExtensionField<() => NodeViewRenderer>(extension, 'addNodeView', { options: extension.options })
      const node = getSchema([StarterKit, extension]).node('memoReference', { id: A, label: '저장 fallback' })
      const view = factory()({ node } as unknown as NodeViewRendererProps)
      const dom = view.dom as unknown as FakeAnchor
      expect(dom.textContent).toBe('처음 제목')
      expect(dom.draggable).toBe(false)
      titles.value = { [A]: '바꾼 제목' }
      expect(dom.textContent).toBe('바꾼 제목')
      expect(node.attrs.label).toBe('저장 fallback')
      const event = new Event('click', { cancelable: true })
      dom.listeners.get('click')!(event)
      expect(event.defaultPrevented).toBe(true)
      expect(onOpen).toHaveBeenCalledWith(A)
      view.update?.(node, [], DecorationSet.empty)
      view.destroy?.()
      titles.value = { [A]: '종료 후' }
      expect(dom.textContent).toBe('바꾼 제목')
      expect(dom.listeners.has('click')).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })
})

describe('[[ 제안의 실제 ProseMirror 범위', () => {
  it('열린/완성된 표기와 제목 블록에서 정확한 교체 범위를 찾는다', () => {
    expect(memoReferenceQuery(state('앞 [[메모'))).toEqual({ from: 3, to: 7, query: '메모' })
    expect(memoReferenceQuery(state('[[ 메모 ]]'))).toEqual({ from: 1, to: 9, query: '메모' })
    expect(memoReferenceQuery(state('[[제목', 'heading'))).toEqual({ from: 1, to: 5, query: '제목' })
  })

  it('코드·코드 mark·선택 영역·escape·이미지 표기는 제안하지 않는다', () => {
    for (const s of [state('[[메모', 'codeBlock'), state('[[메모', 'paragraph', [schema.mark('code')]), state('\\[[메모'), state('![[메모]]'), state('[[메모]'), state(`[[${'a'.repeat(201)}`)]) {
      expect(memoReferenceQuery(s)).toBeNull()
    }
    const s = state('[[메모')
    expect(memoReferenceQuery(s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 3))))).toBeNull()
  })

  it('같은 원문이어도 커서 이동·다른 세션은 이전 교체 범위를 무효화한다', () => {
    const s = state('[[메모')
    const context = memoReferenceContext(s, 'one')!
    expect(currentMemoReferenceContext(context, s, 'one')).toBe(true)
    expect(currentMemoReferenceContext(context, s, 'two')).toBe(false)
    expect(currentMemoReferenceContext(context, s.apply(s.tr.setSelection(TextSelection.create(s.doc, 2))), 'one')).toBe(false)
  })
})

describe('링크 선택 중 저장·서버 응답의 경계', () => {
  function harness() {
    let current = state('앞 [[메모')
    let alive = true
    let scope: string | null = 'one'
    const flush = vi.fn(async () => true)
    const prepare = vi.fn(async () => ({ id: A, title: '선택한 제목' }))
    const insert = vi.fn((tr: Transaction) => { current = current.apply(tr) })
    const options = { alive: () => alive, state: () => current, scope: () => scope, flush, prepare, insert }
    return { options, state: () => current, change: (s: EditorState) => { current = s }, scope: (value: string | null) => { scope = value }, destroy: () => { alive = false } }
  }

  it('현재 입력을 저장한 다음 선택 범위만 atom으로 바꾸고 앞 내용·다른 ID를 보존한다', async () => {
    const h = harness()
    expect(await insertMemoReferenceSafely(h.options)).toBe('inserted')
    expect(h.options.prepare.mock.invocationCallOrder[0]).toBeGreaterThan(h.options.flush.mock.invocationCallOrder[0]!)
    const content = h.state().doc.firstChild!.content
    expect(content.firstChild!.text).toBe('앞 ')
    expect(content.lastChild!.type.name).toBe('memoReference')
    expect(content.lastChild!.attrs).toMatchObject({ id: A, label: '선택한 제목' })
    expect(h.state().selection.from).toBe(4)
  })

  it('저장 실패·저장 중 입력 변경이면 대상 생성/ID 부여도 하지 않는다', async () => {
    const failed = harness()
    failed.options.flush.mockResolvedValueOnce(false)
    expect(await insertMemoReferenceSafely(failed.options)).toBe('save-failed')
    expect(failed.options.prepare).not.toHaveBeenCalled()
    const h = harness()
    const saving = deferred<boolean>()
    h.options.flush.mockReturnValueOnce(saving.promise)
    const pending = insertMemoReferenceSafely(h.options)
    h.change(state('다른 [[입력'))
    saving.resolve(true)
    expect(await pending).toBe('changed')
    expect(h.options.prepare).not.toHaveBeenCalled()
    expect(h.state().doc.textContent).toBe('다른 [[입력')
  })

  it('대상을 만든 뒤 본문/세션/수명이 바뀌면 다른 내용에 링크를 삽입하지 않는다', async () => {
    for (const update of ['document', 'session', 'destroy']) {
      const h = harness()
      const target = deferred<{ id: string; title: string }>()
      h.options.prepare.mockReturnValueOnce(target.promise)
      const pending = insertMemoReferenceSafely(h.options)
      await Promise.resolve()
      if (update === 'document') h.change(state('새 문서'))
      else if (update === 'session') h.scope('two')
      else h.destroy()
      target.resolve({ id: B, title: '만든 메모' })
      expect(await pending).toBe('changed')
      expect(h.options.insert).not.toHaveBeenCalled()
    }
  })
})
