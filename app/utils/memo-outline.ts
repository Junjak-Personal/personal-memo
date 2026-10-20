import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface MemoOutlineEntry {
  pos: number
  level: number
  title: string
  from: number
  to: number
}

export interface MemoOutlineState {
  entries: MemoOutlineEntry[]
  collapsed: ReadonlySet<number>
  disabled: boolean
  decorations: DecorationSet
}

export type MemoOutlineAction =
  | { type: 'toggle'; pos: number }
  | { type: 'reveal'; pos: number }
  | { type: 'expandAll' }
  | { type: 'disabled'; value: boolean }

export const memoOutlineKey = new PluginKey<MemoOutlineState>('memo-outline')

/** 제목은 같은 부모의 다음 동급/상위 제목까지만 접는다. 인용/목록 밖을 삼키지 않는다. */
export function collectMemoOutline(doc: Node): MemoOutlineEntry[] {
  const entries: MemoOutlineEntry[] = []
  function collect(parent: Node, contentStart: number) {
    const children: Array<{ node: Node; pos: number }> = []
    parent.forEach((node, offset) => children.push({ node, pos: contentStart + offset }))
    for (const [index, { node, pos }] of children.entries()) {
      if (node.type.name === 'heading') {
        const level = Number(node.attrs.level) || 1
        const next = children.slice(index + 1).find((child) => child.node.type.name === 'heading' && Number(child.node.attrs.level) <= level)
        const text = node.textBetween(0, node.content.size, ' ', leaf => leaf.type.name === 'memoReference' && typeof leaf.attrs.label === 'string' ? leaf.attrs.label : '')
        entries.push({ pos, level, title: text.replace(/\s+/g, ' ').trim() || '제목 없음', from: pos + node.nodeSize, to: next?.pos ?? contentStart + parent.content.size })
      }
      if (!node.isLeaf) collect(node, pos + 1)
    }
  }
  collect(doc, 0)
  return entries.sort((a, b) => a.pos - b.pos)
}

function hiddenRanges(entries: MemoOutlineEntry[], collapsed: ReadonlySet<number>) {
  return entries.filter(entry => collapsed.has(entry.pos) && entry.from < entry.to)
}

function decorations(doc: Node, entries: MemoOutlineEntry[], collapsed: ReadonlySet<number>): DecorationSet {
  const ranges = hiddenRanges(entries, collapsed)
  const items: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isBlock) return
    if (ranges.some(range => range.from <= pos && pos + node.nodeSize <= range.to)) {
      items.push(Decoration.node(pos, pos + node.nodeSize, { class: 'memo-outline-hidden', 'aria-hidden': 'true' }))
      return false
    }
  })
  return DecorationSet.create(doc, items)
}

function overlapsSelection(entry: MemoOutlineEntry, state: Pick<EditorState, 'selection'>) {
  const selection = state.selection
  return selection.empty
    ? selection.head >= entry.from && selection.head < entry.to
    : selection.from < entry.to && selection.to > entry.from
}

/** 접기는 표시 상태만 바꾼다. 숨은 커서에 입력하지 않도록 접기 직전 제목 끝으로 옮긴다. */
export function memoOutlineTransaction(state: EditorState, action: MemoOutlineAction): Transaction {
  const tr = state.tr.setMeta(memoOutlineKey, action).setMeta('addToHistory', false)
  const outline = memoOutlineKey.getState(state)
  if (action.type === 'toggle' && outline && !outline.disabled && !outline.collapsed.has(action.pos)) {
    const entry = outline.entries.find(item => item.pos === action.pos)
    if (entry && entry.from < entry.to && overlapsSelection(entry, state)) {
      tr.setSelection(TextSelection.near(state.doc.resolve(entry.from - 1), -1))
    }
  }
  return tr
}

export function memoOutlinePlugin() {
  return new Plugin<MemoOutlineState>({
    key: memoOutlineKey,
    state: {
      init: (_config, state) => ({ entries: collectMemoOutline(state.doc), collapsed: new Set(), disabled: false, decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const entries = tr.docChanged ? collectMemoOutline(tr.doc) : previous.entries
        const positions = new Set(entries.map(entry => entry.pos))
        const collapsed = new Set<number>()
        for (const pos of previous.collapsed) {
          const mapped = tr.mapping.mapResult(pos, 1)
          if (!mapped.deleted && positions.has(mapped.pos)) collapsed.add(mapped.pos)
        }
        let disabled = previous.disabled
        const action = tr.getMeta(memoOutlineKey) as MemoOutlineAction | undefined
        if (action?.type === 'disabled') {
          disabled = action.value
          if (disabled) collapsed.clear()
        } else if (action?.type === 'expandAll') collapsed.clear()
        else if (action?.type === 'reveal') {
          for (const range of hiddenRanges(entries, collapsed)) {
            if (range.from <= action.pos && action.pos < range.to) collapsed.delete(range.pos)
          }
        } else if (action?.type === 'toggle' && !disabled) {
          const entry = entries.find(item => item.pos === action.pos)
          if (entry && entry.from < entry.to) {
            if (collapsed.has(action.pos)) collapsed.delete(action.pos)
            else collapsed.add(action.pos)
          }
        }
        // 검색/화살표/외부 명령으로 선택이 들어오면 해당 조상만 펼친다.
        if (tr.selectionSet || tr.docChanged) {
          for (const range of hiddenRanges(entries, collapsed)) {
            if (overlapsSelection(range, tr)) collapsed.delete(range.pos)
          }
        }
        return { entries, collapsed, disabled, decorations: decorations(tr.doc, entries, collapsed) }
      },
    },
    props: {
      decorations: state => memoOutlineKey.getState(state)?.decorations,
      handleDOMEvents: {
        keydown(view, event) {
          if (!event.isComposing && !event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            if (memoOutlineKey.getState(view.state)?.collapsed.size) view.dispatch(memoOutlineTransaction(view.state, { type: 'expandAll' }))
          }
          return false // 브라우저/네이티브 찾기 자체는 계속 처리한다.
        },
      },
    },
  })
}

export const MemoOutlineExtension = Extension.create({
  name: 'memoOutline',
  addProseMirrorPlugins: () => [memoOutlinePlugin()],
})
