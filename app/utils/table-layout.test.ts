import { Schema } from '@tiptap/pm/model'
import type { Node } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { tableNodes } from '@tiptap/pm/tables'
import { describe, expect, it } from 'vitest'
import { tableCellLayouts, tableLayoutPlugin } from './table-layout'

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {},
  ...tableNodes({ tableGroup: 'block', cellContent: 'paragraph+', cellAttributes: {} }),
} })
const p = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined)
const c = (text: string, attrs = {}) => schema.node('table_cell', attrs, p(text))
const h = (text: string, attrs = {}) => schema.node('table_header', attrs, p(text))
const row = (...cells: Node[]) => schema.node('table_row', null, cells)
const table = (...rows: Node[]) => schema.node('table', null, rows)
const classes = (value: Node) => Object.fromEntries(tableCellLayouts(value).map(cell => [value.nodeAt(cell.offset)!.textContent, cell.classes]))
const example = () => table(row(h('유형'), h('오늘 요약')), row(c('개발', { rowspan: 2 }), c('구현')), row(c('검증')))

describe('표의 실제 격자 외곽·모서리', () => {
  it('개발의 좌하단은 외곽, 검증의 좌하단은 내부로 처리해 중복 왼쪽 선을 없앤다', () => {
    const found = classes(example())
    expect(found['개발']).toEqual(['memo-table-edge-s', 'memo-table-corner-bl'])
    expect(found['검증']).toEqual(['memo-table-corner-br'])
    expect(found['구현']).toEqual([])
    expect(found['유형']).toContain('memo-table-corner-tl')
    expect(found['오늘 요약']).toContain('memo-table-corner-tr')
  })
  it('colspan으로 상단 전체를 차지한 셀에는 양쪽 위 모서리를 부여한다', () => {
    const found = classes(table(row(h('오늘 요약', { colspan: 2 })), row(c('개발'), c('검증'))))
    expect(found['오늘 요약']).toEqual(['memo-table-edge-s', 'memo-table-edge-t', 'memo-table-corner-tl', 'memo-table-corner-tr'])
    expect(found['개발']).toEqual(['memo-table-edge-s', 'memo-table-corner-bl'])
    expect(found['검증']).toEqual(['memo-table-corner-br'])
  })
  it('행·열을 동시에 병합한 셀과 아래 행의 내부 셀을 구분한다', () => {
    const found = classes(table(row(h('유형'), h('작업'), h('상태')), row(c('개발', { rowspan: 2, colspan: 2 }), c('구현')), row(c('검증'))))
    expect(found['개발']).toEqual(['memo-table-edge-s', 'memo-table-corner-bl'])
    expect(found['검증']).toEqual(['memo-table-corner-br'])
  })
  it('일반 표의 외곽은 기존과 같고 중간 행/헤더에 위쪽 선을 중복하지 않는다', () => {
    const found = classes(table(row(h('A'), h('B')), row(h('C'), c('D')), row(c('E'), c('F'))))
    expect(found.A).toEqual(['memo-table-edge-s', 'memo-table-edge-t', 'memo-table-corner-tl'])
    expect(found.B).toEqual(['memo-table-edge-t', 'memo-table-corner-tr'])
    expect(found.C).toEqual(['memo-table-edge-s'])
    expect(found.D).toEqual([])
    expect(found.E).toEqual(['memo-table-edge-s', 'memo-table-corner-bl'])
    expect(found.F).toEqual(['memo-table-corner-br'])
  })
  it('셀 하나인 표는 네 모서리를 모두 가진다', () => {
    expect(classes(table(row(c('하나'))))['하나']).toEqual(['memo-table-edge-s', 'memo-table-edge-t', 'memo-table-corner-tl', 'memo-table-corner-tr', 'memo-table-corner-bl', 'memo-table-corner-br'])
  })
  it('decorations는 문서 위치/내용 변경 때 재계산되고 저장 내용과 selection만 바뀔 때는 건드리지 않는다', () => {
    const plugin = tableLayoutPlugin()
    let state = EditorState.create({ doc: schema.node('doc', null, [p('앞'), example()]), plugins: [plugin] })
    const original = state.doc.toJSON()
    const before = plugin.getState(state)!
    const firstCell = before.find()[0]!
    expect(state.doc.nodeAt(firstCell.from)?.textContent).toBe('유형')
    expect(state.doc.toJSON()).toEqual(original)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)))
    expect(plugin.getState(state)).toBe(before)
    const inserted = p('새 문단')
    state = state.apply(state.tr.insert(0, inserted))
    const after = plugin.getState(state)!
    expect(after.find()[0]!.from).toBe(firstCell.from + inserted.nodeSize)
    expect(state.doc.nodeAt(after.find()[0]!.from)?.textContent).toBe('유형')
    expect(JSON.stringify(state.doc.toJSON())).not.toContain('memo-table-corner')
  })
})
