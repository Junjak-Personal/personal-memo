import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { Node, ResolvedPos } from '@tiptap/pm/model'
import type { Mappable } from '@tiptap/pm/transform'
import { NodeSelection, Plugin, Selection, TextSelection } from '@tiptap/pm/state'
import type { EditorState, SelectionBookmark, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { insertMemoPlainText } from './editor-paste'

function resolveBlocks(doc: Node, anchor: number, head: number): Selection {
  if (anchor >= 0 && head >= 0 && anchor <= doc.content.size && head <= doc.content.size && anchor !== head) {
    const $anchor = doc.resolve(anchor)
    const $head = doc.resolve(head)
    if ($anchor.sameParent($head) && !$anchor.parent.inlineContent) return new MemoBlockSelection($anchor, $head)
  }
  return Selection.near(doc.resolve(Math.max(0, Math.min(anchor, doc.content.size))))
}

class MemoBlockBookmark implements SelectionBookmark {
  constructor(readonly anchor: number, readonly head: number) {}
  map(mapping: Mappable) { return new MemoBlockBookmark(mapping.map(this.anchor), mapping.map(this.head)) }
  resolve(doc: Node) { return resolveBlocks(doc, this.anchor, this.head) }
}

/** 형제 블록의 경계만 선택한다. 복사·잘라내기·이동·undo가 같은 선택 범위를 사용한다. */
export class MemoBlockSelection extends Selection {
  constructor($anchor: ResolvedPos, $head: ResolvedPos) { super($anchor, $head); this.visible = false }
  map(doc: Node, mapping: Mappable) { return resolveBlocks(doc, mapping.map(this.anchor), mapping.map(this.head)) }
  eq(other: Selection) { return other instanceof MemoBlockSelection && other.anchor === this.anchor && other.head === this.head }
  toJSON() { return { type: 'memoBlocks', anchor: this.anchor, head: this.head } }
  override getBookmark() { return new MemoBlockBookmark(this.anchor, this.head) }
  static override fromJSON(doc: Node, value: unknown) {
    if (!value || typeof value !== 'object' || !('anchor' in value) || !('head' in value) || typeof value.anchor !== 'number' || typeof value.head !== 'number') throw new RangeError('블록 선택 위치가 올바르지 않습니다')
    return resolveBlocks(doc, value.anchor, value.head)
  }
}
Selection.jsonID('memoBlocks', MemoBlockSelection)

function currentBlocks(state: EditorState) {
  const { selection } = state
  if (selection instanceof MemoBlockSelection) return selection
  if (selection instanceof NodeSelection && selection.node.isBlock) return resolveBlocks(state.doc, selection.from, selection.to)
  const { $from, $to } = selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name === 'table' && $to.pos <= $from.after(depth)) return resolveBlocks(state.doc, $from.before(depth), $from.after(depth))
  }
  // 목록 첫 문단은 항목의 본문이므로 자식 목록과 함께 선택한다.
  if ($from.sameParent($to)) {
    const parent = $from.node(-1)
    if ((parent.type.name === 'listItem' || parent.type.name === 'taskItem') && $from.index($from.depth - 1) === 0) return resolveBlocks(state.doc, $from.before($from.depth - 1), $from.after($from.depth - 1))
  }
  const range = $from.blockRange($to)
  return range ? resolveBlocks(state.doc, range.start, range.end) : null
}

export function selectMemoBlocks(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const selection = currentBlocks(state)
  if (!(selection instanceof MemoBlockSelection)) return false
  if (dispatch) dispatch(state.tr.setSelection(selection).scrollIntoView())
  return true
}

export function extendMemoBlocks(state: EditorState, direction: -1 | 1, dispatch?: (tr: Transaction) => void) {
  if (!(state.selection instanceof MemoBlockSelection)) return false
  const { selection } = state
  const $head = selection.$head
  const parent = $head.parent
  const index = $head.index()
  if ((direction < 0 && index === 0) || (direction > 0 && index === parent.childCount)) return true
  const neighbor = parent.child(direction < 0 ? index - 1 : index)
  const head = selection.head + direction * neighbor.nodeSize
  if (head === selection.anchor) return true
  if (dispatch) dispatch(state.tr.setSelection(resolveBlocks(state.doc, selection.anchor, head)).scrollIntoView())
  return true
}

export function duplicateMemoBlocks(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const selection = currentBlocks(state)
  if (!(selection instanceof MemoBlockSelection)) return false
  const content = state.doc.slice(selection.from, selection.to).content
  if (!selection.$from.parent.canReplace(selection.$to.index(), selection.$to.index(), content)) return false
  if (dispatch) {
    const tr = closeHistory(state.tr).insert(selection.to, content)
    tr.setSelection(resolveBlocks(tr.doc, selection.to, selection.to + content.size))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export function moveMemoBlocks(state: EditorState, direction: -1 | 1, dispatch?: (tr: Transaction) => void) {
  const selection = currentBlocks(state)
  if (!(selection instanceof MemoBlockSelection)) return false
  const { $from, $to } = selection
  const index = direction < 0 ? $from.index() - 1 : $to.index()
  if (index < 0 || index >= $from.parent.childCount) return false
  const neighbor = $from.parent.child(index)
  const content = state.doc.slice(selection.from, selection.to).content
  const replacement = direction < 0 ? content.addToEnd(neighbor) : content.addToStart(neighbor)
  const from = selection.from - (direction < 0 ? neighbor.nodeSize : 0)
  const to = selection.to + (direction > 0 ? neighbor.nodeSize : 0)
  if (!$from.parent.canReplace(direction < 0 ? index : $from.index(), direction < 0 ? $to.index() : index + 1, replacement)) return false
  if (dispatch) {
    const tr = closeHistory(state.tr).replaceWith(from, to, replacement)
    const delta = direction * neighbor.nodeSize
    tr.setSelection(resolveBlocks(tr.doc, selection.anchor + delta, selection.head + delta))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export function deleteMemoBlocks(state: EditorState, dispatch?: (tr: Transaction) => void) {
  if (!(state.selection instanceof MemoBlockSelection)) return false
  if (dispatch) {
    const { $from, $to } = state.selection
    // 마지막 항목을 지우면 목록 래퍼도 지운다. 스키마의 자동 채움으로 빈 체크 항목이 되살아나지 않게 한다.
    const wholeList = ['bulletList', 'orderedList', 'taskList'].includes($from.parent.type.name) && $from.pos === $from.start() && $to.pos === $to.end()
    const from = wholeList ? $from.before() : state.selection.from
    const to = wholeList ? $to.after() : state.selection.to
    const tr = closeHistory(state.tr).delete(from, to)
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export function toggleMemoTask(state: EditorState, dispatch?: (tr: Transaction) => void) {
  const { selection } = state
  const positions: number[] = []
  if (selection instanceof MemoBlockSelection) {
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (node.type.name === 'taskItem') { positions.push(pos); return false }
      return node.type.name !== 'table' && node.type.name !== 'codeBlock'
    })
  } else {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      if (selection.$from.node(depth).type.name === 'taskItem') { positions.push(selection.$from.before(depth)); break }
    }
  }
  if (!positions.length) return false
  if (dispatch) {
    const checked = positions.some(pos => state.doc.nodeAt(pos)?.attrs.checked !== true)
    const tr = closeHistory(state.tr)
    for (const pos of positions) {
      const node = state.doc.nodeAt(pos)!
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked })
    }
    dispatch(tr)
  }
  return true
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    memoInteractions: {
      indentMemoList: () => ReturnType
      outdentMemoList: () => ReturnType
      selectMemoBlock: () => ReturnType
      extendMemoBlockSelection: (direction: -1 | 1) => ReturnType
      duplicateMemoBlocks: () => ReturnType
      moveMemoBlocks: (direction: -1 | 1) => ReturnType
      deleteMemoBlocks: () => ReturnType
      toggleMemoTask: () => ReturnType
    }
  }
}

export const MemoInteractions = Extension.create({
  name: 'memoInteractions',
  // 슬래시·이모지 메뉴가 Escape/방향키를 먼저 처리한다.
  priority: 90,
  addCommands() {
    return {
      selectMemoBlock: () => ({ state, dispatch }) => this.editor.isEditable && selectMemoBlocks(state, dispatch),
      extendMemoBlockSelection: direction => ({ state, dispatch }) => this.editor.isEditable && extendMemoBlocks(state, direction, dispatch),
      duplicateMemoBlocks: () => ({ state, dispatch }) => this.editor.isEditable && duplicateMemoBlocks(state, dispatch),
      moveMemoBlocks: direction => ({ state, dispatch }) => this.editor.isEditable && moveMemoBlocks(state, direction, dispatch),
      deleteMemoBlocks: () => ({ state, dispatch }) => this.editor.isEditable && deleteMemoBlocks(state, dispatch),
      toggleMemoTask: () => ({ state, dispatch }) => this.editor.isEditable && !this.editor.isActive('codeBlock') && !this.editor.isActive('table') && toggleMemoTask(state, dispatch),
    }
  },
  addKeyboardShortcuts() {
    const ready = () => this.editor.isEditable && !this.editor.view.composing
    const blockAction = () => ready() && (!this.editor.isActive('table') || this.editor.state.selection instanceof MemoBlockSelection)
    const edit = () => {
      const { selection } = this.editor.state
      if (!(selection instanceof MemoBlockSelection)) return false
      return this.editor.commands.setTextSelection(Selection.near(this.editor.state.doc.resolve(selection.from), 1).from)
    }
    return {
      Escape: () => ready() && (this.editor.state.selection instanceof MemoBlockSelection ? edit() : this.editor.commands.selectMemoBlock()),
      Enter: () => ready() && edit(),
      'Shift-ArrowUp': () => ready() && this.editor.commands.extendMemoBlockSelection(-1),
      'Shift-ArrowDown': () => ready() && this.editor.commands.extendMemoBlockSelection(1),
      'Mod-d': () => blockAction() && this.editor.commands.duplicateMemoBlocks(),
      'Mod-Shift-ArrowUp': () => blockAction() && this.editor.commands.moveMemoBlocks(-1),
      'Mod-Shift-ArrowDown': () => blockAction() && this.editor.commands.moveMemoBlocks(1),
      Backspace: () => ready() && this.editor.commands.deleteMemoBlocks(),
      Delete: () => ready() && this.editor.commands.deleteMemoBlocks(),
      'Mod-Enter': () => ready() && this.editor.commands.toggleMemoTask(),
    }
  },
  addProseMirrorPlugins() {
    let plainPasteUntil = 0
    return [new Plugin({ props: {
      handleDOMEvents: {
        keydown: (view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'v') plainPasteUntil = Date.now() + 2000
          else if (!['Meta', 'Control', 'Shift'].includes(event.key)) plainPasteUntil = 0
          // 조합 확정 키가 블록 분리·삭제 명령으로 들어가지 않게 한다.
          if ((event.isComposing || view.composing) && ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape'].includes(event.key)) return true
          // HardBreak의 기본 Mod-Enter보다 먼저 현재 체크 항목을 전환한다.
          if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === 'Enter' && this.editor.isEditable && !this.editor.isActive('codeBlock') && !this.editor.isActive('table') && toggleMemoTask(view.state, tr => view.dispatch(tr))) {
            event.preventDefault()
            return true
          }
          // Tab을 편집 명령으로 쓰는 본문에서도 Esc → Tab으로 도구/다음 컨트롤로 나갈 수 있다.
          if (event.key === 'Tab' && view.state.selection instanceof MemoBlockSelection) { view.dom.blur(); return true }
          if (view.state.selection instanceof MemoBlockSelection && ['Enter', 'Backspace', 'Delete'].includes(event.key)) {
            event.preventDefault()
            if (event.key === 'Enter') this.editor.commands.setTextSelection(Selection.near(view.state.doc.resolve(view.state.selection.from), 1).from)
            else this.editor.commands.deleteMemoBlocks()
            return true
          }
          return false
        },
        paste: (_view, event) => {
          const plain = plainPasteUntil > Date.now()
          plainPasteUntil = 0
          if (!plain || !event.clipboardData) return false
          const text = event.clipboardData.getData('text/plain')
          if (!text) return false
          event.preventDefault()
          insertMemoPlainText(this.editor, text)
          return true
        },
      },
      decorations: state => {
        const { selection } = state
        if (!(selection instanceof MemoBlockSelection)) return null
        const decorations: Decoration[] = []
        state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
          if (node.isBlock) { decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'bg-primary/15 outline outline-1 outline-primary/40 rounded-sm', 'data-memo-block-selected': 'true' })); return false }
          return true
        })
        return DecorationSet.create(state.doc, decorations)
      },
    } })]
  },
})
