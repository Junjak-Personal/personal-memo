import type { JSONContent } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import type { Schema } from '@tiptap/pm/model'
import { Table, TableCell, TableHeader, TableKit } from '@tiptap/extension-table'
import type { TableOptions } from '@tiptap/extension-table'
import { tableLayoutPlugin } from './table-layout'

/** 큰/음수/소수 span으로 비정상적인 표 grid가 생기지 않게 한다. 병합은 양의 정수만 지원한다. */
export function tableSpan(value: unknown): number {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '')
  if (!/^\d+$/.test(raw)) return 1
  const span = Number(raw)
  return Number.isSafeInteger(span) && span >= 1 && span <= 1000 ? span : 1
}

export function tableUsesHtml(node: JSONContent): boolean {
  return node.attrs?.memoTableFormat === 'html' || hasMergedCells(node)
}

export function hasMergedCells(node: JSONContent): boolean {
  return (node.content ?? []).some(row => (row.content ?? []).some(cell => tableSpan(cell.attrs?.rowspan) > 1 || tableSpan(cell.attrs?.colspan) > 1))
}

const MemoTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: { default: 1, parseHTML: el => tableSpan(el.getAttribute('colspan')) },
      rowspan: { default: 1, parseHTML: el => tableSpan(el.getAttribute('rowspan')) },
    }
  },
})
const MemoTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colspan: { default: 1, parseHTML: el => tableSpan(el.getAttribute('colspan')) },
      rowspan: { default: 1, parseHTML: el => tableSpan(el.getAttribute('rowspan')) },
    }
  },
})

export function memoTableKit() {
  // MarkdownManager는 kit을 다시 펼치고 storage도 새로 만든다. 한 확장 묶음 안에서만 스키마를 공유한다.
  let schema: Schema | null = null
  const MemoTable = Table.extend<TableOptions>({
    addAttributes() {
      return {
        ...this.parent?.(),
        memoTableFormat: {
          default: 'markdown',
          // GFM은 parseMarkdown으로 읽는다. HTML 입력은 병합 유무와 무관하게 별도 저장 유형이다.
          parseHTML: el => {
            const merged = [...el.querySelectorAll('td,th')].some(cell => tableSpan(cell.getAttribute('rowspan')) > 1 || tableSpan(cell.getAttribute('colspan')) > 1)
            return el.getAttribute('data-memo-table') === 'markdown' && !merged ? 'markdown' : 'html'
          },
          renderHTML: attrs => ({ 'data-memo-table': attrs.memoTableFormat === 'html' ? 'html' : 'markdown' }),
        },
      }
    },
    onBeforeCreate() { schema = this.editor.schema },
    addProseMirrorPlugins() { return [...(this.parent?.() ?? []), tableLayoutPlugin()] },
    renderMarkdown(node, helpers, context) {
      if (!tableUsesHtml(node)) return this.parent!(node, helpers, context)
      // GFM 표에는 span이 없다. HTML 파싱/보기는 기존 스키마를 그대로 쓰고 HTML 유형은 병합을 풀어도 HTML로 보관한다.
      if (!schema) throw new Error('표 직렬화에 필요한 스키마가 없습니다')
      // fromSchema 결과는 schema에 캐시된다. 저장용 이미지 매핑이 보기/클립보드에 섞이지 않게 복사한다.
      const base = DOMSerializer.fromSchema(schema)
      const serializer = new DOMSerializer({ ...base.nodes }, { ...base.marks })
      const image = serializer.nodes.image
      if (image) {
        serializer.nodes.image = imageNode => {
          const spec = image(imageNode)
          // MemoImage의 화면용 URL 대신 원래 저장 경로를 쓴다. 나머지 속성은 기존 렌더러를 따른다.
          if (Array.isArray(spec) && spec[0] === 'img' && typeof spec[1] === 'object' && spec[1] !== null) {
            return ['img', { ...spec[1], src: imageNode.attrs.src }]
          }
          return spec
        }
      }
      const table = document.createElement('table')
      table.setAttribute('data-memo-table', 'html')
      const body = document.createElement('tbody')
      // 화면 렌더러가 생성하는 colgroup/min-width는 저장하지 않는다. 셀/내용/서식은 스키마로 직렬화한다.
      body.append(serializer.serializeFragment(schema.nodeFromJSON(node).content))
      table.append(body)
      return table.outerHTML
    },
  })

  /** 이름/기존 commands는 유지한다. 사람용 표 편집 UI에는 병합 조작을 추가하지 않는다. */
  return TableKit.extend({
    addExtensions() {
      return this.parent!().map(extension => {
        if (extension.name === 'table') return MemoTable.configure(this.options.table || {})
        if (extension.name === 'tableCell') return MemoTableCell.configure(this.options.tableCell || {})
        if (extension.name === 'tableHeader') return MemoTableHeader.configure(this.options.tableHeader || {})
        return extension
      })
    },
  })
}
