import { createRequire } from 'node:module'
import { getSchema } from '@tiptap/core'
import { history, undo } from '@tiptap/pm/history'
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { memoTableKit, tableEditFormat } from './editor-table'

const require = createRequire(import.meta.resolve('@nuxt/ui'))
const { StarterKit } = require('@tiptap/starter-kit')
const schema = getSchema([StarterKit, memoTableKit()])
const paragraph = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined)
const header = () => schema.node('tableHeader', null, paragraph('머리글'))
const table = () => schema.node('table', { memoTableFormat: 'markdown' }, [schema.node('tableRow', null, [header(), header()])])
const doc = () => schema.node('doc', null, [table(), paragraph('뒤 문단')])

describe('표 상세 편집의 저장 유형', () => {
  it('셀 안의 커서로 편집하면 표의 셀과 선택을 보존하며 HTML 유형으로 바꾼다', () => {
    const original = doc()
    const state = EditorState.create({ doc: original, selection: TextSelection.create(original, 4) })
    const tr = state.tr
    expect(tableEditFormat(tr)).toBe(true)
    expect(tr.doc.firstChild!.attrs.memoTableFormat).toBe('html')
    expect(tr.doc.firstChild!.content.eq(original.firstChild!.content)).toBe(true)
    expect(tr.selection.toJSON()).toEqual(state.selection.toJSON())
    expect(tr.doc.lastChild!.eq(original.lastChild!)).toBe(true)
  })

  it('표 자체를 선택한 경우에도 동작하고 can 검사는 transaction을 수정하지 않는다', () => {
    const original = doc()
    const state = EditorState.create({ doc: original, selection: NodeSelection.create(original, 0) })
    const tr = state.tr
    expect(tableEditFormat(tr, false)).toBe(true)
    expect(tr.steps).toHaveLength(0)
    expect(tableEditFormat(tr)).toBe(true)
    expect(tr.doc.firstChild!.attrs.memoTableFormat).toBe('html')
  })

  it('표 밖의 선택은 문서를 바꾸지 않는다', () => {
    const original = schema.node('doc', null, paragraph('본문'))
    const tr = EditorState.create({ doc: original }).tr
    expect(tableEditFormat(tr)).toBe(false)
    expect(tr.steps).toHaveLength(0)
  })

  it('머리글 변경과 유형 변경을 같은 transaction에 담으면 한 번에 실행 취소한다', () => {
    const original = doc()
    let state = EditorState.create({ doc: original, selection: TextSelection.create(original, 4), plugins: [history()] })
    const tr = state.tr
    expect(tableEditFormat(tr)).toBe(true)
    tr.setNodeMarkup(2, schema.nodes.tableCell)
    state = state.apply(tr)
    expect(state.doc.firstChild!.firstChild!.firstChild!.type.name).toBe('tableCell')
    expect(undo(state, transaction => { state = state.apply(transaction) })).toBe(true)
    expect(state.doc.eq(original)).toBe(true)
  })
})
