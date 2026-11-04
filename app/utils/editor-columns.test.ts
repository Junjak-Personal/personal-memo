import { createRequire } from 'node:module'
import { getSchema } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { history, undo } from '@tiptap/pm/history'
import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { MemoReference } from './memo-reference'
import { memoTableKit } from './editor-table'
import { memoColumnCount, memoColumnsKit, memoColumnsSerializer, setMemoColumnsTransaction, tokenizeMemoColumns, unsetMemoColumnsTransaction } from './editor-columns'

const require = createRequire(import.meta.resolve('@nuxt/ui'))
const { StarterKit } = require('@tiptap/starter-kit')
const { MarkdownManager } = require('@tiptap/markdown')
const schema = getSchema([StarterKit, Image, memoTableKit(), memoColumnsKit()])
const paragraph = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined)
const column = (...blocks: ProseMirrorNode[]) => schema.node('memoColumn', null, blocks)
const columns = (...children: ProseMirrorNode[]) => schema.node('memoColumns', { count: children.length }, children)
const doc = (...blocks: ProseMirrorNode[]) => schema.node('doc', null, blocks)
const state = (document: ProseMirrorNode, from = 1, to = from) => EditorState.create({ doc: document, selection: TextSelection.create(document, from, to) })

describe('메모 2·3·4단 모델과 명령', () => {
  it.each([2, 3, 4])('현재 블록을 %i단의 첫 칸에 감싸고 나머지를 빈 문단으로 채운다', count => {
    const original = paragraph('사진 옆에 둘 설명')
    const tr = state(doc(original)).tr
    expect(setMemoColumnsTransaction(tr, count)).toBe(true)
    const group = tr.doc.firstChild!
    expect(group.type.name).toBe('memoColumns')
    expect(group.attrs.count).toBe(count)
    expect(group.childCount).toBe(count)
    expect(group.firstChild!.firstChild!.eq(original)).toBe(true)
    for (let index = 1; index < count; index++) expect(group.child(index).firstChild!.eq(paragraph(''))).toBe(true)
    tr.doc.check()
  })

  it('선택한 최상위 블록들을 순서대로 첫 단에 담고 나머지 문서는 유지한다', () => {
    const first = paragraph('첫째')
    const heading = schema.node('heading', { level: 2 }, schema.text('둘째'))
    const last = paragraph('마지막')
    const original = doc(first, heading, last)
    const tr = state(original, 1, first.nodeSize + heading.nodeSize - 1).tr
    expect(setMemoColumnsTransaction(tr, 2)).toBe(true)
    expect(tr.doc.childCount).toBe(2)
    expect(tr.doc.firstChild!.firstChild!.content.eq(doc(first, heading).content)).toBe(true)
    expect(tr.doc.lastChild!.eq(last)).toBe(true)
  })

  it('블록 경계에서 끝난 선택은 다음 블록까지 감싸지 않는다', () => {
    const first = paragraph('첫째')
    const original = doc(first, paragraph('둘째'))
    const initial = EditorState.create({ doc: original, selection: NodeSelection.create(original, 0) })
    const tr = initial.tr
    expect(setMemoColumnsTransaction(tr, 3)).toBe(true)
    expect(tr.doc.firstChild!.firstChild!.childCount).toBe(1)
    expect(tr.doc.lastChild!.textContent).toBe('둘째')
  })

  it('목록 안에서 실행하면 목록 전체를 감싸고 목록 내용을 유지한다', () => {
    const list = schema.node('bulletList', null, [schema.node('listItem', null, paragraph('목록 문장'))])
    const tr = state(doc(list), 3).tr
    expect(setMemoColumnsTransaction(tr, 2)).toBe(true)
    expect(tr.doc.firstChild!.firstChild!.firstChild!.eq(list)).toBe(true)
    tr.doc.check()
  })

  it('활성 그룹의 단 수를 늘릴 때 기존 단을 그대로 두며 중첩 그룹을 만들지 않는다', () => {
    const left = column(paragraph('왼쪽'))
    const right = column(paragraph('오른쪽'))
    const tr = state(doc(columns(left, right)), 3).tr
    expect(setMemoColumnsTransaction(tr, 4)).toBe(true)
    const group = tr.doc.firstChild!
    expect(group.childCount).toBe(4)
    expect(group.child(0).eq(left)).toBe(true)
    expect(group.child(1).eq(right)).toBe(true)
    let groups = 0
    tr.doc.descendants(node => { if (node.type.name === 'memoColumns') groups++ })
    expect(groups).toBe(1)
  })

  it('4단을 2단으로 줄여도 오른쪽의 사진·표·서식·문단을 마지막 단에 순서대로 보존한다', () => {
    const image = schema.node('image', { src: 'assets/photo.png', alt: '풍경' })
    const bold = schema.node('paragraph', null, schema.text('굵게', [schema.mark('bold')]))
    const table = schema.node('table', { memoTableFormat: 'html' }, [schema.node('tableRow', null, [schema.node('tableCell', null, paragraph('표 내용'))])])
    const original = columns(column(paragraph('왼쪽')), column(image), column(bold, table), column(paragraph('마지막')))
    const tr = state(doc(original), 3).tr
    expect(setMemoColumnsTransaction(tr, 2)).toBe(true)
    const group = tr.doc.firstChild!
    expect(group.childCount).toBe(2)
    expect(group.lastChild!.content.eq(column(image, bold, table, paragraph('마지막')).content)).toBe(true)
    tr.doc.check()
  })

  it('해제는 모든 단의 블록을 읽는 순서로 펼치고 뒤의 문단을 보존한다', () => {
    const original = doc(columns(column(paragraph('첫째')), column(paragraph('둘째'), paragraph('셋째'))), paragraph('그다음'))
    const tr = state(original, 3).tr
    expect(unsetMemoColumnsTransaction(tr)).toBe(true)
    expect(tr.doc.eq(doc(paragraph('첫째'), paragraph('둘째'), paragraph('셋째'), paragraph('그다음')))).toBe(true)
  })

  it('그룹 자체가 선택된 경우에도 변경과 해제가 가능하다', () => {
    const original = doc(columns(column(paragraph('A')), column(paragraph('B'))))
    const tr = EditorState.create({ doc: original, selection: NodeSelection.create(original, 0) }).tr
    expect(setMemoColumnsTransaction(tr, 3)).toBe(true)
    expect(unsetMemoColumnsTransaction(tr)).toBe(true)
    expect(tr.doc.textContent).toBe('AB')
  })

  it('다른 블록과 기존 그룹을 함께 선택해도 중첩 다단으로 감싸지 않는다', () => {
    const first = paragraph('앞')
    const group = columns(column(paragraph('A')), column(paragraph('B')))
    const original = doc(first, group)
    const tr = state(original, 1, original.content.size - 3).tr
    expect(setMemoColumnsTransaction(tr, 2)).toBe(false)
    expect(tr.doc.eq(original)).toBe(true)
  })

  it('can 검사와 범위를 벗어난 단 수는 문서를 바꾸지 않는다', () => {
    const original = doc(paragraph('원본'))
    const tr = state(original).tr
    expect(setMemoColumnsTransaction(tr, 3, false)).toBe(true)
    expect(tr.steps).toHaveLength(0)
    for (const invalid of [0, 1, 5, -2, 2.5, NaN, Infinity]) expect(setMemoColumnsTransaction(tr, invalid)).toBe(false)
    expect(unsetMemoColumnsTransaction(tr)).toBe(false)
    expect(tr.doc.eq(original)).toBe(true)
  })

  it('연속 실행한 단 수 변경과 해제는 한 동작씩 실행 취소한다', () => {
    let current = EditorState.create({ doc: doc(paragraph('내용 보존')), plugins: [history()] })
    for (const count of [4, 2, 3]) {
      const tr = current.tr
      expect(setMemoColumnsTransaction(tr, count)).toBe(true)
      current = current.apply(tr)
    }
    const threeColumns = current.doc
    const flatten = current.tr
    expect(unsetMemoColumnsTransaction(flatten)).toBe(true)
    current = current.apply(flatten)
    expect(current.doc.firstChild!.type.name).toBe('paragraph')
    expect(undo(current, tr => { current = current.apply(tr) })).toBe(true)
    expect(current.doc.eq(threeColumns)).toBe(true)
    expect(undo(current, tr => { current = current.apply(tr) })).toBe(true)
    expect(current.doc.firstChild!.attrs.count).toBe(2)
    expect(undo(current, tr => { current = current.apply(tr) })).toBe(true)
    expect(current.doc.firstChild!.attrs.count).toBe(4)
    expect(current.doc.textContent).toBe('내용 보존')
  })
})

describe('저장용 다단 HTML과 Markdown 경계', () => {
  it('지원하는 단 수만 받아 HTML 속성이나 style 주입을 거부한다', () => {
    for (const value of [2, 3, 4, '2', '3', '4']) expect(memoColumnCount(value)).toBe(Number(value))
    for (const value of [null, undefined, '', '02', '2.0', '5', '2" style="color:red', {}, true]) expect(memoColumnCount(value)).toBeNull()
  })

  it('빈 줄·중첩 div·주석이 들어간 그룹을 한 HTML 토큰으로 잡고 뒤의 Markdown을 남긴다', () => {
    const html = '<div data-memo-columns="2"><div data-memo-column=""><p>왼쪽</p><pre><code>첫 줄\n\n끝 줄</code></pre></div><div data-memo-column=""><!-- <div>무시</div> --><p>오른쪽</p></div></div>'
    const token = tokenizeMemoColumns(`${html}\n\n## 다음 문서`)
    expect(token).toMatchObject({ type: 'html', raw: html, text: html, block: true })
    for (const source of ['<div data-memo-columns="1"><div></div></div>', '<div data-memo-columns="2"><div>', '<div><p>보통 HTML</p></div>', '`<div data-memo-columns="2">`']) expect(tokenizeMemoColumns(source)).toBeUndefined()
  })

  it('직렬화 마커는 지원하는 단 수와 개별 단 마커뿐이다', () => {
    const serializer = DOMSerializer.fromSchema(schema)
    const group = columns(column(paragraph('A')), column(paragraph('B')))
    expect(serializer.nodes.memoColumns!(group)).toEqual(['div', { 'data-memo-columns': 2 }, 0])
    expect(serializer.nodes.memoColumn!(group.firstChild!)).toEqual(['div', { 'data-memo-column': '' }, 0])
  })

  it('저장용 이미지 URL은 상대경로이며 화면 serializer 캐시를 바꾸지 않는다', () => {
    const mapped = Image.extend({ renderHTML: ({ node }) => ['img', { src: `/api/files/${String(node.attrs.src)}` }] })
    const imageSchema = getSchema([StarterKit, mapped, memoColumnsKit()])
    const image = imageSchema.node('image', { src: 'assets/photo.png' })
    const screen = DOMSerializer.fromSchema(imageSchema)
    expect(screen.nodes.image!(image)).toEqual(['img', { src: '/api/files/assets/photo.png' }])
    expect(memoColumnsSerializer(imageSchema).nodes.image!(image)).toEqual(['img', { src: 'assets/photo.png' }])
    expect(screen.nodes.image!(image)).toEqual(['img', { src: '/api/files/assets/photo.png' }])
  })

  it('표와 메모 참조는 화면용 레이아웃이나 비공개 제목 조회 없이 저장한다', () => {
    const local = getSchema([StarterKit, memoTableKit(), MemoReference, memoColumnsKit()])
    const serializer = memoColumnsSerializer(local)
    const table = local.node('table', { memoTableFormat: 'markdown' }, [local.node('tableRow', null, [local.node('tableCell', null, local.node('paragraph'))])])
    expect(serializer.nodes.table!(table)).toEqual(['table', { 'data-memo-table': 'markdown' }, ['tbody', 0]])
    const id = '01K7ZY4YF8GSF5H4JEH2R2DW4C'
    const reference = local.node('memoReference', { id, label: '저장된 제목' })
    expect(serializer.nodes.memoReference!(reference)).toEqual(['a', { href: `/m/${id}` }, '저장된 제목'])
  })

  it('다단이 없는 기존 Markdown의 모델과 출력은 변경하지 않는다', () => {
    const previous = new MarkdownManager({ extensions: [StarterKit, Image, memoTableKit()] })
    const next = new MarkdownManager({ extensions: [StarterKit, Image, memoTableKit(), memoColumnsKit()] })
    for (const source of ['# 제목\n\n**서식**과 문단', '- 첫째\n- 둘째', '![사진](assets/photo.png)', '| 이름 | 내용 |\n| --- | --- |\n| 표 | 그대로 |', '```html\n<div>일반 코드</div>\n```']) {
      expect(next.parse(source)).toEqual(previous.parse(source))
      expect(next.serialize(next.parse(source))).toBe(previous.serialize(previous.parse(source)))
    }
  })
})
