import { getSchema, Mark, Node } from '@tiptap/core'
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list'
import { history, undo } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { EditorState, Selection, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { deleteMemoBlocks, duplicateMemoBlocks, extendMemoBlocks, MemoBlockSelection, moveMemoBlocks, selectMemoBlocks, toggleMemoTask } from './editor-interactions'

const schema = getSchema([
  Node.create({ name: 'doc', topNode: true, content: 'block+' }),
  Node.create({ name: 'paragraph', group: 'block', content: 'inline*' }),
  Node.create({ name: 'text', group: 'inline' }),
  Mark.create({ name: 'bold' }),
  BulletList, OrderedList, ListItem, TaskList, TaskItem.configure({ nested: true }),
])
const paragraph = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined)
const task = (text: string, checked = false, ...children: ProseMirrorNode[]) => schema.node('taskItem', { checked }, [paragraph(text), ...children])
const tasks = (...items: ProseMirrorNode[]) => schema.node('taskList', null, items)
const doc = (...blocks: ProseMirrorNode[]) => schema.node('doc', null, blocks)
const state = (document: ProseMirrorNode, from = 1) => EditorState.create({ doc: document, selection: TextSelection.create(document, from), plugins: [history()] })
function run(initial: EditorState, command: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean) {
  let result = initial
  expect(command(initial, tr => { result = initial.apply(tr) })).toBe(true)
  result.doc.check()
  return result
}

describe('문서 블록 선택과 조작', () => {
  it('목록 첫 문단을 선택하면 완료 상태와 원래 자식을 포함한 항목을 선택한다', () => {
    const parent = task('부모', true, tasks(task('자식')))
    const selected = run(state(doc(tasks(parent, task('다음'))), 3), selectMemoBlocks)
    expect(selected.selection).toBeInstanceOf(MemoBlockSelection)
    // 클립보드 slice에는 원래 목록 래퍼도 들어가 체크 항목 유형을 보존한다.
    expect(selected.selection.content().content.firstChild!.firstChild!.eq(parent)).toBe(true)
  })

  it('Shift+방향키 선택 확장은 형제 블록 경계에서 멈춘다', () => {
    const initial = state(doc(paragraph('하나'), paragraph('둘'), paragraph('셋')))
    let selected = run(initial, selectMemoBlocks)
    selected = run(selected, (s, d) => extendMemoBlocks(s, 1, d))
    expect(selected.selection.content().content.childCount).toBe(2)
    selected = run(selected, (s, d) => extendMemoBlocks(s, 1, d))
    expect(selected.selection.content().content.childCount).toBe(3)
    const atEnd = selected.selection
    selected = run(selected, (s, d) => extendMemoBlocks(s, 1, d))
    expect(selected.selection.eq(atEnd)).toBe(true)
  })

  it('블록을 복제하면 선택한 여러 블록과 서식만 그대로 복제한다', () => {
    const bold = schema.node('paragraph', null, schema.text('굵은 둘', [schema.mark('bold')]))
    let current = run(state(doc(paragraph('하나'), bold, paragraph('셋'))), selectMemoBlocks)
    current = run(current, (s, d) => extendMemoBlocks(s, 1, d))
    const selected = current.selection.content().content
    current = run(current, duplicateMemoBlocks)
    expect(current.doc.childCount).toBe(5)
    expect(current.selection.content().content.eq(selected)).toBe(true)
    expect(current.doc.lastChild!.textContent).toBe('셋')
    expect(current.selection.content().content.lastChild!.firstChild!.marks[0]!.type.name).toBe('bold')
  })

  it('문장 커서에서 복제해도 현재 문단 한 개만 복제한다', () => {
    const current = run(state(doc(paragraph('하나'), paragraph('둘'))), duplicateMemoBlocks)
    expect(current.doc.childCount).toBe(3)
    expect(current.doc.child(1).textContent).toBe('하나')
    expect(current.doc.child(2).textContent).toBe('둘')
  })

  it('목록 항목 묶음을 이동해도 다른 항목·완료 상태·하위 목록을 보존한다', () => {
    const a = task('하나')
    const b = task('둘', true, tasks(task('자식')))
    const c = task('셋')
    let current = run(state(doc(tasks(a, b, c)), a.nodeSize + 3), selectMemoBlocks)
    current = run(current, (s, d) => moveMemoBlocks(s, -1, d))
    expect(current.doc.firstChild!.child(0).eq(b)).toBe(true)
    expect(current.doc.firstChild!.child(1).eq(a)).toBe(true)
    expect(current.doc.firstChild!.child(2).eq(c)).toBe(true)
    current = run(current, (s, d) => moveMemoBlocks(s, 1, d))
    expect(current.doc.eq(doc(tasks(a, b, c)))).toBe(true)
  })

  it('선택된 블록 이동은 한 번의 실행 취소로 원본 문서를 되살린다', () => {
    const original = doc(paragraph('하나'), paragraph('둘'), paragraph('셋'))
    let current = run(state(original), selectMemoBlocks)
    current = run(current, (s, d) => moveMemoBlocks(s, 1, d))
    expect(undo(current, tr => { current = current.apply(tr) })).toBe(true)
    expect(current.doc.eq(original)).toBe(true)
  })

  it('선택한 모든 블록을 삭제해도 입력 가능한 빈 문단을 남긴다', () => {
    let current = run(state(doc(paragraph('하나'))), selectMemoBlocks)
    current = run(current, deleteMemoBlocks)
    expect(current.doc.childCount).toBe(1)
    expect(current.doc.firstChild!.type.name).toBe('paragraph')
    expect(current.doc.textContent).toBe('')
    expect(current.selection.empty).toBe(true)
  })

  it('목록의 마지막 항목 삭제는 빈 체크 항목을 새로 만들지 않는다', () => {
    let current = run(state(doc(tasks(task('마지막'))), 3), selectMemoBlocks)
    current = run(current, deleteMemoBlocks)
    expect(current.doc.firstChild!.type.name).toBe('paragraph')
    expect(current.doc.textContent).toBe('')
  })

  it('하위 목록의 마지막 항목을 삭제해도 부모 항목은 그대로 둔다', () => {
    let current = run(state(doc(tasks(task('부모', true, tasks(task('마지막 자식'))))), '부모'.length + 7), selectMemoBlocks)
    current = run(current, deleteMemoBlocks)
    expect(current.doc.firstChild!.firstChild!.textContent).toBe('부모')
    expect(current.doc.firstChild!.firstChild!.attrs.checked).toBe(true)
    expect(current.doc.firstChild!.firstChild!.childCount).toBe(1)
  })

  it('일반 글자 선택에서 Delete 명령은 기본 편집 동작에 맡긴다', () => {
    const current = state(doc(paragraph('본문')))
    expect(deleteMemoBlocks(current)).toBe(false)
    expect(extendMemoBlocks(current, 1)).toBe(false)
    expect(current.doc.textContent).toBe('본문')
  })

  it('처음/마지막에서 이동 can 검사는 문서를 바꾸지 않는다', () => {
    let current = run(state(doc(paragraph('하나'), paragraph('둘'))), selectMemoBlocks)
    const original = current.doc
    expect(moveMemoBlocks(current, -1)).toBe(false)
    expect(moveMemoBlocks(current, 1)).toBe(true)
    expect(duplicateMemoBlocks(current)).toBe(true)
    expect(current.doc.eq(original)).toBe(true)
  })

  it('블록 선택은 앞 문단 삽입·직렬화·bookmark 왕복에서 유지된다', () => {
    const current = run(state(doc(paragraph('하나'), paragraph('둘'))), selectMemoBlocks)
    const prefix = paragraph('앞에 삽입')
    const inserted = current.apply(current.tr.insert(0, prefix))
    expect(inserted.selection).toBeInstanceOf(MemoBlockSelection)
    expect(inserted.selection.content().content.firstChild!.textContent).toBe('하나')
    expect(Selection.fromJSON(inserted.doc, inserted.selection.toJSON()).eq(inserted.selection)).toBe(true)
    expect(inserted.selection.getBookmark().resolve(inserted.doc).eq(inserted.selection)).toBe(true)
  })

  it('완료 전환은 현재 체크 항목만 바꾸며 자식의 상태를 유지한다', () => {
    const initial = state(doc(tasks(task('부모', false, tasks(task('자식'))))), 3)
    const toggled = run(initial, toggleMemoTask)
    expect(toggled.doc.firstChild!.firstChild!.attrs.checked).toBe(true)
    expect(toggled.doc.firstChild!.firstChild!.lastChild!.firstChild!.attrs.checked).toBe(false)
    expect(toggleMemoTask(state(doc(paragraph('본문'))))).toBe(false)
  })

  it('여러 체크 항목의 완료 상태는 선택된 항목들에만 적용한다', () => {
    let current = run(state(doc(tasks(task('하나', true), task('둘'), task('셋'))), 3), selectMemoBlocks)
    current = run(current, (s, d) => extendMemoBlocks(s, 1, d))
    current = run(current, toggleMemoTask)
    expect([0, 1, 2].map(index => current.doc.firstChild!.child(index).attrs.checked)).toEqual([true, true, false])
  })
})
