import { Schema } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { history, undo } from '@tiptap/pm/history'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { describe, expect, it } from 'vitest'
import { collectMemoOutline, memoOutlineKey, memoOutlinePlugin, memoOutlineTransaction } from './memo-outline'

const schema = new Schema({ nodes: {
  doc: { content: 'block*' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*' },
  heading: { group: 'block', content: 'inline*', attrs: { level: { default: 1 } } },
  memoReference: { inline: true, group: 'inline', atom: true, attrs: { label: { default: '' } } },
  blockquote: { group: 'block', content: 'block+' },
  bulletList: { group: 'block', content: 'listItem+' },
  listItem: { content: 'paragraph block*' },
} })
const p = (text: string) => schema.node('paragraph', null, schema.text(text))
const h = (level: number, text: string) => schema.node('heading', { level }, schema.text(text))
function state(...nodes: ProseMirrorNode[]) {
  return EditorState.create({ doc: schema.node('doc', null, nodes), plugins: [memoOutlinePlugin(), history()] })
}
const outline = (s: EditorState) => memoOutlineKey.getState(s)!
const fold = (s: EditorState, pos: number) => s.apply(memoOutlineTransaction(s, { type: 'toggle', pos }))

describe('문서 목차와 표시 전용 제목 접기', () => {
  it('제목의 내부 메모 링크도 원래 표시 이름으로 목차에 포함한다', () => {
    const doc = schema.node('doc', null, schema.node('heading', { level: 1 }, [schema.text('프로젝트 '), schema.node('memoReference', { label: '개발 기록' })]))
    expect(collectMemoOutline(doc)[0]?.title).toBe('프로젝트 개발 기록')
  })
  it('제목 단계/빈 제목을 수집하고 다음 동급·상위 제목까지 범위를 계산한다', () => {
    const doc = schema.node('doc', null, [h(1, '큰 제목'), p('소개'), h(2, '작은 제목'), p('상세'), h(1, '다음'), schema.node('heading', { level: 3 })])
    const entries = collectMemoOutline(doc)
    expect(entries.map(entry => [entry.title, entry.level])).toEqual([['큰 제목', 1], ['작은 제목', 2], ['다음', 1], ['제목 없음', 3]])
    expect(entries[0]!.to).toBe(entries[2]!.pos)
    expect(entries[1]!.to).toBe(entries[2]!.pos)
    expect(entries[3]!.from).toBe(entries[3]!.to)
  })

  it('인용·목록 안 제목은 자기 부모 밖의 본문을 접지 않는다', () => {
    const quote = schema.node('blockquote', null, [h(2, '인용 제목'), p('인용 내용')])
    const list = schema.node('bulletList', null, schema.node('listItem', null, [p('목록 앞'), h(3, '목록 제목'), p('목록 내용')]))
    const s = state(h(1, '본문 제목'), quote, list, p('바깥 내용'), h(1, '끝'))
    const entries = outline(s).entries
    const q = entries.find(entry => entry.title === '인용 제목')!
    const l = entries.find(entry => entry.title === '목록 제목')!
    expect(q.to).toBe(h(1, '본문 제목').nodeSize + quote.nodeSize - 1)
    expect(l.to).toBe(h(1, '본문 제목').nodeSize + quote.nodeSize + list.nodeSize - 2)
    const folded = fold(s, q.pos)
    const decorations = outline(folded).decorations.find()
    expect(decorations.map(item => [item.from, item.to])).toEqual([[q.from, q.to]])
    expect(decorations.every(item => item.to <= q.to)).toBe(true)
  })

  it('접기/펼치기는 본문·노드 속성·문서 JSON을 변경하지 않는다', () => {
    const original = state(h(1, '제목'), p('본문'), h(1, '다음'), p('남음'))
    const snapshot = original.doc.toJSON()
    const collapsed = fold(original, 0)
    expect(collapsed.doc.toJSON()).toEqual(snapshot)
    expect(outline(collapsed).collapsed.has(0)).toBe(true)
    expect(outline(collapsed).decorations.find()).toHaveLength(1)
    // Decoration의 런타임 node attrs는 공개 타입에서 숨겨져 있다. 실제 표시 속성만 좁혀 검증한다.
    const decorated = outline(collapsed).decorations.find()[0]! as unknown as { type: { attrs: Record<string, string> } }
    expect(decorated.type.attrs).toMatchObject({ class: 'memo-outline-hidden', 'aria-hidden': 'true' })
    const expanded = fold(collapsed, 0)
    expect(expanded.doc.toJSON()).toEqual(snapshot)
    expect(outline(expanded).collapsed.size).toBe(0)
    expect(outline(expanded).decorations.find()).toHaveLength(0)
  })

  it('접힐 구역 안의 커서는 제목 끝으로 옮기고 undo 기록은 편집만 되돌린다', () => {
    let s = state(h(1, '제목'), p('본문'))
    const from = outline(s).entries[0]!.from
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, from + 1)).insertText('수정'))
    const tr = memoOutlineTransaction(s, { type: 'toggle', pos: 0 })
    expect(tr.docChanged).toBe(false)
    expect(tr.getMeta('addToHistory')).toBe(false)
    expect(tr.selection.head).toBe(from - 1)
    s = s.apply(tr)
    expect(outline(s).collapsed.has(0)).toBe(true)
    expect(undo(s, next => { s = s.apply(next) })).toBe(true)
    expect(s.doc.textContent).toBe('제목본문')
  })

  it('제목 앞 삽입은 접힌 위치를 따라가고 제목 삭제/본문 변환은 접힘을 버린다', () => {
    let s = fold(state(h(1, '제목'), p('본문'), h(1, '다음')), 0)
    const prefix = p('앞 문단')
    s = s.apply(s.tr.insert(0, prefix))
    expect([...outline(s).collapsed]).toEqual([prefix.nodeSize])
    s = s.apply(s.tr.delete(prefix.nodeSize, prefix.nodeSize + h(1, '제목').nodeSize))
    expect(outline(s).collapsed.size).toBe(0)
    let converted = fold(state(h(1, '제목'), p('본문')), 0)
    converted = converted.apply(converted.tr.setNodeMarkup(0, schema.nodes.paragraph))
    expect(outline(converted).collapsed.size).toBe(0)
  })

  it('중첩 접힘은 유지하고 숨은 제목으로 이동하면 조상만 펼친다', () => {
    let s = state(h(1, '부모'), p('소개'), h(2, '자식'), p('상세'), h(1, '다음'))
    const child = outline(s).entries[1]!
    s = fold(fold(s, child.pos), 0)
    expect(outline(s).collapsed.size).toBe(2)
    s = s.apply(memoOutlineTransaction(s, { type: 'reveal', pos: child.pos }).setSelection(TextSelection.near(s.doc.resolve(child.pos + 1))))
    expect([...outline(s).collapsed]).toEqual([child.pos])
    expect(outline(s).decorations.find().map(item => item.from)).toEqual([child.from])
  })

  it('숨은 본문으로 선택/외부 명령이 들어가면 해당 구역을 펼친다', () => {
    let s = fold(state(h(1, '제목'), p('본문')), 0)
    const entry = outline(s).entries[0]!
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, entry.from + 1)))
    expect(outline(s).collapsed.size).toBe(0)
    s = fold(s, 0)
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, s.doc.content.size - 1)))
    expect(outline(s).collapsed.size).toBe(0)
  })

  it('블록 이동 모드에서는 모두 펼치고 다시 접지 않는다', () => {
    let s = fold(state(h(1, '제목'), p('본문')), 0)
    s = s.apply(memoOutlineTransaction(s, { type: 'disabled', value: true }))
    expect(outline(s).collapsed.size).toBe(0)
    expect(outline(s).disabled).toBe(true)
    s = fold(s, 0)
    expect(outline(s).collapsed.size).toBe(0)
    s = s.apply(memoOutlineTransaction(s, { type: 'disabled', value: false }))
    expect(outline(fold(s, 0)).collapsed.has(0)).toBe(true)
  })

  it('Ctrl/CmdF는 접기를 풀고 기본 찾기 처리를 가로채지 않는다', () => {
    let s = fold(state(h(1, '제목'), p('본문')), 0)
    const plugin = s.plugins.find(item => item === memoOutlineKey.get(s))!
    const view = { get state() { return s }, dispatch: (tr: ReturnType<typeof memoOutlineTransaction>) => { s = s.apply(tr) } } as unknown as EditorView
    const event = { key: 'f', ctrlKey: true, metaKey: false, altKey: false, isComposing: false } as KeyboardEvent
    expect(plugin.props.handleDOMEvents!.keydown!.call(plugin, view, event)).toBe(false)
    expect(outline(s).collapsed.size).toBe(0)
  })
})
