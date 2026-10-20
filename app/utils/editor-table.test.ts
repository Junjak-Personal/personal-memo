import { createRequire } from 'node:module'
import type { JSONContent } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import { describe, expect, it } from 'vitest'
import { hasMergedCells, memoTableKit, tableSpan, tableUsesHtml } from './editor-table'

const require = createRequire(import.meta.resolve('@nuxt/ui'))
const { MarkdownManager } = require('@tiptap/markdown')
const { StarterKit } = require('@tiptap/starter-kit')

const cell = (attrs = {}) => ({ type: 'tableCell', attrs, content: [{ type: 'paragraph', content: [{ type: 'text', text: '내용' }] }] })
const table = (...cells: JSONContent[]): JSONContent => ({ type: 'table', content: [{ type: 'tableRow', content: cells }] })

describe('병합 표의 호환성·span 경계', () => {
  it.each([undefined, null, '', '0', '-1', '1.5', '2e2', 'Infinity', '1001', '9999999999999999999', '2" onclick="alert(1)'])('잘못된 span %s는 안전한 기본 1이다', value => {
    expect(tableSpan(value)).toBe(1)
  })
  it.each([2, '2', ' 2 ', '002', 1000])('양의 정수 span %s를 보존한다', value => {
    expect(tableSpan(value)).toBe(Number(value))
  })
  it('가로·세로 병합만 HTML 직렬화 대상으로 삼는다', () => {
    expect(hasMergedCells(table(cell()))).toBe(false)
    expect(hasMergedCells(table(cell({ rowspan: 1, colspan: 1 })))).toBe(false)
    expect(hasMergedCells(table(cell({ rowspan: 2 })))).toBe(true)
    expect(hasMergedCells(table(cell({ colspan: 2 })))).toBe(true)
  })
  it('명시적인 HTML 유형은 병합을 없애도 Markdown 표로 바뀌지 않는다', () => {
    expect(tableUsesHtml({ ...table(cell()), attrs: { memoTableFormat: 'html' } })).toBe(true)
    expect(tableUsesHtml({ ...table(cell()), attrs: { memoTableFormat: 'markdown' } })).toBe(false)
    expect(tableUsesHtml(table(cell({ rowspan: 2 })))).toBe(true)
  })
  it('일반 Markdown 표·정렬·코드의 기존 읽기/출력은 TableKit과 같다', () => {
    const old = new MarkdownManager({ extensions: [StarterKit, TableKit] })
    const current = new MarkdownManager({ extensions: [StarterKit, memoTableKit()] })
    for (const source of ['| 유형 | 내용 |\n| --- | --- |\n| 개발 | 요약 |', '| 왼쪽 | 오른쪽 |\n| :--- | ---: |\n| **굵게** | `a \\| b` |', '# 제목\n\n보통 **메모**\n\n- 목록']) {
      expect(current.parse(source)).toEqual(old.parse(source))
      expect(current.serialize(current.parse(source))).toBe(old.serialize(old.parse(source)))
    }
  })
})
