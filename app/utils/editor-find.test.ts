import { history, undo } from '@tiptap/pm/history'
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { findMemoText, MAX_MEMO_FIND_MATCHES, memoFindKey, memoFindPlugin, replaceMemoMatches, searchMemoTransaction, selectMemoMatch } from './editor-find'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    hardBreak: { inline: true, group: 'inline', atom: true },
    memoReference: { inline: true, group: 'inline', atom: true, attrs: { label: { default: '' } } },
  },
  marks: { bold: {} },
})
const text = (value: string) => schema.text(value)
const paragraph = (...nodes: ReturnType<typeof text>[]) => schema.node('paragraph', null, nodes)
const document = (...nodes: ReturnType<typeof paragraph>[]) => schema.node('doc', null, nodes)
const state = (doc: ReturnType<typeof document>) => EditorState.create({ doc, plugins: [memoFindPlugin(), history()] })

describe('문서 내 찾기·바꾸기의 문서 경계', () => {
  it('문자열을 정규식 문법으로 해석하지 않고 대소문자를 구분할 수 있다', () => {
    const doc = document(paragraph(text('a.b A.B a?b aXb')))
    expect(findMemoText(doc, 'a.b').matches).toEqual([{ from: 1, to: 4 }, { from: 5, to: 8 }])
    expect(findMemoText(doc, 'a.b', true).matches).toEqual([{ from: 1, to: 4 }])
    expect(findMemoText(doc, 'a?b').matches).toEqual([{ from: 9, to: 12 }])
    expect(findMemoText(doc, '').matches).toEqual([])
  })
  it('서식이 다른 텍스트 조각은 이어 찾되 문단·줄바꿈·참조 노드는 건너지 않는다', () => {
    const doc = document(paragraph(schema.text('ab', [schema.mark('bold')]), text('cd'), schema.node('hardBreak'), text('ef'), schema.node('memoReference', { label: '참조' }), text('gh')), paragraph(text('ij')))
    expect(findMemoText(doc, 'bc').matches).toEqual([{ from: 2, to: 4 }])
    for (const query of ['de', 'fg', 'hi', '참조']) expect(findMemoText(doc, query).matches).toEqual([])
  })
  it('유니코드 대소문자 비교 후에도 실제 문서 위치를 사용한다', () => {
    const doc = document(paragraph(text('İ İ TEST test')))
    expect(findMemoText(doc, 'test').matches).toEqual([{ from: 5, to: 9 }, { from: 10, to: 14 }])
  })
  it('검색 결과를 제한하고 제한 여부를 알려 일부만 모두 바꾸는 일을 막는다', () => {
    const found = findMemoText(document(paragraph(text('a'.repeat(MAX_MEMO_FIND_MATCHES + 1)))), 'a')
    expect(found.matches).toHaveLength(MAX_MEMO_FIND_MATCHES)
    expect(found.limited).toBe(true)
  })
  it('검색과 탐색은 문서를 바꾸지 않고 선택 범위·강조만 갱신한다', () => {
    let current = state(document(paragraph(text('하나 둘 하나'))))
    const original = current.doc
    current = current.apply(searchMemoTransaction(current, '하나', false))
    expect(memoFindKey.getState(current)?.matches).toHaveLength(2)
    const tr = selectMemoMatch(current, 1)!
    expect(tr.docChanged).toBe(false)
    expect(tr.getMeta('addToHistory')).toBe(false)
    current = current.apply(tr)
    expect(current.doc.eq(original)).toBe(true)
    expect(current.selection.from).toBe(6)
    expect(current.selection.to).toBe(8)
    expect(memoFindKey.getState(current)?.activeIndex).toBe(1)
    expect(memoFindKey.getState(current)?.decorations.find()).toHaveLength(2)
  })
  it('모두 바꾸기는 주변 서식을 보존하고 한 번 실행 취소한다', () => {
    let current = state(document(paragraph(schema.text('앞 ', [schema.mark('bold')]), text('찾기 중간 찾기'), schema.text(' 뒤', [schema.mark('bold')]))))
    const original = current.doc
    const matches = findMemoText(current.doc, '찾기').matches
    const tr = replaceMemoMatches(current, matches, '교체한 내용')!
    expect(tr.steps).toHaveLength(2)
    current = current.apply(tr)
    expect(current.doc.textContent).toBe('앞 교체한 내용 중간 교체한 내용 뒤')
    expect(current.doc.firstChild?.firstChild?.marks[0]?.type.name).toBe('bold')
    expect(current.doc.firstChild?.lastChild?.marks[0]?.type.name).toBe('bold')
    expect(undo(current, transaction => { current = current.apply(transaction) })).toBe(true)
    expect(current.doc.eq(original)).toBe(true)
  })
  it('빈 교체 문자열은 일치 부분만 지우고 문단·atom을 가로지르는 범위는 거절한다', () => {
    const initial = state(document(paragraph(text('abc'), schema.node('memoReference'), text('def')), paragraph(text('ghi'))))
    expect(replaceMemoMatches(initial, [{ from: 2, to: 6 }], 'x')).toBeNull()
    expect(replaceMemoMatches(initial, [{ from: 6, to: 11 }], 'x')).toBeNull()
    expect(replaceMemoMatches(initial, [{ from: 2, to: 3 }, { from: 1, to: 4 }], 'x')).toBeNull()
    expect(replaceMemoMatches(initial, findMemoText(initial.doc, 'bc').matches, '')?.doc.textContent).toBe('adefghi')
  })
  it('본문 변경 후 검색 결과·강조 위치를 다시 계산하고 초기화한다', () => {
    let current = state(document(paragraph(text('하나 하나'))))
    current = current.apply(searchMemoTransaction(current, '하나', false))
    current = current.apply(current.tr.insertText('앞 ', 1))
    expect(memoFindKey.getState(current)?.matches[0]).toEqual({ from: 3, to: 5 })
    current = current.apply(searchMemoTransaction(current, '', false))
    expect(memoFindKey.getState(current)?.decorations.find()).toHaveLength(0)
  })
})
