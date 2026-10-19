import { Schema } from '@tiptap/pm/model'
import { closeHistory, history, redo, undo } from '@tiptap/pm/history'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { blockEdgeScrollDelta, blockInsertionIndex, getTopLevelBlocks, moveBlockTransaction } from './block-move'

const schema = new Schema({
  nodes: {
    doc: { content: 'block*' },
    paragraph: { group: 'block', content: 'inline*', attrs: { id: { default: null } } },
    text: { group: 'inline' },
    image: { group: 'block', atom: true, attrs: { src: {}, alt: { default: '' } } },
    bulletList: { group: 'block', content: 'listItem+' },
    listItem: { content: 'paragraph block*', attrs: { checked: { default: false } } },
    table: { group: 'block', content: 'tableRow+', attrs: { layout: { default: null } } },
    tableRow: { content: 'tableCell+' },
    tableCell: { content: 'paragraph+', attrs: { colspan: { default: 1 } } },
  },
  marks: { bold: {}, link: { attrs: { href: {} } } },
})
const p = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined)
const createState = (...text: string[]) => EditorState.create({ doc: schema.node('doc', null, text.map(p)), plugins: [history()] })

describe('모바일 최상위 블록 이동', () => {
  it('문서 위치와 간단한 읽기용 이름을 목록/표 내부에 진입하지 않고 얻는다', () => {
    const list = schema.node('bulletList', null, schema.node('listItem', null, [p('첫 항목'), p('둘째 문단')]))
    const image = schema.node('image', { src: '/test.png', alt: '테스트 이미지' })
    const blocks = getTopLevelBlocks(schema.node('doc', null, [p('첫\n   문단'), list, image]))
    expect(blocks).toEqual([
      { index: 0, pos: 0, nodeSize: 9, type: 'paragraph', label: '문단: 첫 문단' },
      { index: 1, pos: 9, nodeSize: list.nodeSize, type: 'bulletList', label: '글머리 목록: 첫 항목 둘째 문단' },
      { index: 2, pos: 9 + list.nodeSize, nodeSize: 1, type: 'image', label: '이미지: 테스트 이미지' },
    ])
  })

  it('첫 블록을 맨 아래로, 마지막 블록을 맨 위로 이동한다', () => {
    const state = createState('A', 'B', 'C')
    const down = moveBlockTransaction(state, 0, 3)!
    expect(down.doc.textContent).toBe('BCA')
    expect(down.steps).toHaveLength(2)
    const up = moveBlockTransaction(state, 2, 0)!
    expect(up.doc.textContent).toBe('CAB')
  })

  it('서로 이웃한 경계로 놓거나 범위를 벗어난 요청이면 변경하지 않는다', () => {
    const state = createState('A', 'B', 'C')
    for (const [from, to] of [[1, 1], [1, 2], [-1, 0], [3, 0], [0, -1], [0, 4], [0.5, 1], [0, Number.NaN]]) {
      expect(moveBlockTransaction(state, from!, to!)).toBeNull()
    }
    expect(moveBlockTransaction(createState('A'), 0, 1)).toBeNull()
    expect(moveBlockTransaction(createState(), 0, 0)).toBeNull()
    expect(getTopLevelBlocks(createState().doc)).toEqual([])
  })

  it('복잡한 목록, 표, 이미지의 속성·중첩·서식을 그대로 옮긴다', () => {
    const marked = schema.node('paragraph', { id: 'keep' }, schema.text('중요', [schema.marks.bold!.create(), schema.marks.link!.create({ href: '/target' })]))
    const nested = schema.node('bulletList', null, schema.node('listItem', { checked: true }, [marked, schema.node('bulletList', null, schema.node('listItem', null, p('중첩')))]))
    const table = schema.node('table', { layout: 'wide' }, schema.node('tableRow', null, schema.node('tableCell', { colspan: 2 }, marked)))
    const image = schema.node('image', { src: '/original.png', alt: '원본' })
    for (const complex of [nested, table, image]) {
      const state = EditorState.create({ doc: schema.node('doc', null, [complex, p('B')]) })
      const tr = moveBlockTransaction(state, 0, 2)!
      expect(tr.doc.lastChild!.toJSON()).toEqual(complex.toJSON())
      expect(tr.doc.childCount).toBe(2)
      expect(tr.doc.firstChild!.textContent).toBe('B')
    }
  })

  it('이동한 블록 내 역방향 텍스트 선택과 다른 블록의 커서를 보존한다', () => {
    const base = createState('ABCDE', 'FGH', 'IJKL')
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 5, 2)))
    const tr = moveBlockTransaction(state, 0, 3)!
    const offset = p('FGH').nodeSize + p('IJKL').nodeSize
    expect(tr.selection.anchor).toBe(5 + offset)
    expect(tr.selection.head).toBe(2 + offset)
    expect(tr.doc.textBetween(tr.selection.from, tr.selection.to)).toBe('BCD')

    const elsewhere = base.apply(base.tr.setSelection(TextSelection.create(base.doc, 9)))
    const up = moveBlockTransaction(elsewhere, 2, 0)!
    expect(up.selection.anchor).toBe(9 + p('IJKL').nodeSize)
  })

  it('선택된 원자 블록은 이동 후에도 선택된 상태다', () => {
    const image = schema.node('image', { src: '/image.png' })
    const state = EditorState.create({ doc: schema.node('doc', null, [image, p('ABC')]) })
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)))
    const tr = moveBlockTransaction(selected, 0, 2)!
    expect(tr.selection).toBeInstanceOf(NodeSelection)
    expect(tr.selection.from).toBe(p('ABC').nodeSize)
    expect((tr.selection as NodeSelection).node.eq(image)).toBe(true)
  })

  it('이동 한 번은 이전 입력과 분리된 한 번의 실행 취소/다시 실행이다', () => {
    let state = createState('A', 'B', 'C')
    state = state.apply(state.tr.insertText('x', 2))
    const beforeMove = state.doc
    state = state.apply(moveBlockTransaction(state, 0, 3)!)
    expect(state.doc.textContent).toBe('BCAx')
    expect(undo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(state.doc.eq(beforeMove)).toBe(true)
    expect(redo(state, tr => { state = state.apply(tr) })).toBe(true)
    expect(state.doc.textContent).toBe('BCAx')
    // UI가 이동 종료 시 history를 닫으면 뒤따르는 키보드 입력도 독립적이다.
    state = state.apply(closeHistory(state.tr).setMeta('addToHistory', false))
    state = state.apply(state.tr.insertText('z', state.doc.content.size - 1))
    undo(state, tr => { state = state.apply(tr) })
    expect(state.doc.textContent).toBe('BCAx')
    undo(state, tr => { state = state.apply(tr) })
    expect(state.doc.eq(beforeMove)).toBe(true)
  })
})

describe('드래그 배치와 화면 가장자리 스크롤', () => {
  it('서로 다른 높이의 블록 중간점을 기준으로 첫/중간/끝 경계를 고른다', () => {
    const rects = [{ top: 10, bottom: 30 }, { top: 40, bottom: 140 }, { top: 150, bottom: 180 }]
    expect(blockInsertionIndex(-1, rects)).toBe(0)
    expect(blockInsertionIndex(20, rects)).toBe(1)
    expect(blockInsertionIndex(89, rects)).toBe(1)
    expect(blockInsertionIndex(90, rects)).toBe(2)
    expect(blockInsertionIndex(999, rects)).toBe(3)
    expect(blockInsertionIndex(0, [])).toBe(0)
  })

  it('가운데는 스크롤하지 않고 가장자리 가까울수록 제한된 속도로 스크롤한다', () => {
    const viewport = { top: 100, bottom: 500 }
    expect(blockEdgeScrollDelta(300, viewport)).toBe(0)
    expect(blockEdgeScrollDelta(132, viewport)).toBe(-8)
    expect(blockEdgeScrollDelta(468, viewport)).toBe(8)
    expect(blockEdgeScrollDelta(0, viewport)).toBe(-16)
    expect(blockEdgeScrollDelta(900, viewport)).toBe(16)
    expect(blockEdgeScrollDelta(120, { top: 100, bottom: 140 })).toBe(0)
    expect(blockEdgeScrollDelta(0, { top: 0, bottom: 0 })).toBe(0)
    expect(blockEdgeScrollDelta(Number.NaN, viewport)).toBe(0)
  })
})
