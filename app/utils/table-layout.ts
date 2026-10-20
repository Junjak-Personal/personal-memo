import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TableMap } from '@tiptap/pm/tables'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** DOM의 first/last 셀이 아니라 병합을 포함한 실제 표 격자에서 외곽을 구한다. */
export function tableCellLayouts(table: Node) {
  const map = TableMap.get(table)
  return [...new Set(map.map)].filter(offset => offset > 0).map(offset => {
    const rect = map.findCell(offset)
    const classes: string[] = []
    if (rect.left === 0) classes.push('memo-table-edge-s')
    if (rect.top === 0) classes.push('memo-table-edge-t')
    if (rect.left === 0 && rect.top === 0) classes.push('memo-table-corner-tl')
    if (rect.right === map.width && rect.top === 0) classes.push('memo-table-corner-tr')
    if (rect.left === 0 && rect.bottom === map.height) classes.push('memo-table-corner-bl')
    if (rect.right === map.width && rect.bottom === map.height) classes.push('memo-table-corner-br')
    return { offset, classes }
  })
}

function decorations(doc: Node): DecorationSet {
  const cells: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.tableRole !== 'table') return
    for (const { offset, classes } of tableCellLayouts(node)) {
      const cell = node.nodeAt(offset)
      if (cell && classes.length) cells.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + cell.nodeSize, { class: classes.join(' ') }))
    }
  })
  return DecorationSet.create(doc, cells)
}

/** 표시 전용 decoration이다. HTML/Markdown 저장 내용이나 undo 기록은 바꾸지 않는다. */
export function tableLayoutPlugin() {
  const key = new PluginKey<DecorationSet>('memo-table-layout')
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => decorations(state.doc),
      apply: (tr, previous) => tr.docChanged ? decorations(tr.doc) : previous,
    },
    props: { decorations: state => key.getState(state) },
  })
}
