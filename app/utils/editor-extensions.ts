import { Extension, getPreviousBlockSibling } from '@tiptap/core'
import type { AnyExtension, CommandProps } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import type { ImageOptions } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Underline from '@tiptap/extension-underline'
import { lift } from '@tiptap/pm/commands'
import { Fragment } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode, NodeRange } from '@tiptap/pm/model'
import { liftListItem, sinkListItem } from '@tiptap/pm/schema-list'
import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { CodeBlockShiki } from 'tiptap-extension-code-block-shiki'
import { MemoEmoji } from './editor-emoji'
import { memoTableKit } from './editor-table'
import { memoColumnsKit } from './editor-columns'
import { MemoReference } from './memo-reference'
import { memoImageMarkdown } from './editor-image'
import type { MemoReferenceOptions } from './memo-reference'
import { MemoInteractions } from './editor-interactions'

/**
 * 밑줄 — 마크다운에는 `<u>text</u>` 로 쓴다.
 *
 * Tiptap 기본은 `++text++` 인데 CommonMark/GFM 문법이 아니라 다른 도구에서 `++` 가 그대로 보인다.
 * 기본 토크나이저는 `C++ 와 C++` 같은 평문도 밑줄로 읽는다.
 *
 * 🔴 `<u>` 를 인라인 HTML 로 읽게 두면 안 된다. 그러면 안쪽 `**굵게**` 가 마크다운이 아니라
 *    글자로 들어오고, 저장할 때마다 `\*\*` → `\\\*\\\*` 로 역슬래시가 불어난다 (스파이크 S2 실측).
 *    그래서 `<u>…</u>` 를 직접 토큰으로 잘라 안쪽을 인라인 마크다운으로 다시 읽는다.
 */
export const HtmlUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`
  },
  markdownTokenizer: {
    name: 'underline',
    level: 'inline',
    start: (src) => src.indexOf('<u>'),
    tokenize(src, _tokens, lexer) {
      const match = /^<u>([\s\S]+?)<\/u>/.exec(src)
      if (!match) return undefined
      const inner = match[1]!
      return { type: 'underline', raw: match[0], text: inner, tokens: lexer.inlineTokens(inner) }
    },
  },
})

interface MemoImageOptions extends ImageOptions {
  /** 본문 속 상대경로 → 화면 주소 */
  toDisplay: (src: string) => string
  /** 화면 주소 → 본문 속 경로 (복사·붙여넣기로 HTML 을 거쳐 돌아올 때) */
  toStored: (src: string) => string
}

/**
 * 이미지 — 노드 속성에는 본문 속 상대경로를 그대로 두고, 그릴 때만 화면 주소로 바꾼다.
 *
 * renderMarkdown 은 노드 속성(src)을 그대로 쓰므로 저장되는 마크다운에 서버 주소가 섞이지 않는다.
 * 클립보드는 renderHTML 결과(화면 주소)를 담으므로, 붙여넣을 때 parseHTML 에서 되돌린다.
 */
export const MemoImage = Image.extend<MemoImageOptions>({
  renderMarkdown(node, helpers, context) {
    return memoImageMarkdown(node) ?? this.parent!(node, helpers, context)
  },
  addOptions() {
    return {
      ...this.parent!(),
      toDisplay: (src: string) => src,
      toStored: (src: string) => src,
    }
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('src')
          return raw ? this.options.toStored(raw) : null
        },
        renderHTML: (attrs) => ({
          src: typeof attrs.src === 'string' ? this.options.toDisplay(attrs.src) : null,
        }),
      },
    }
  },
})

function isListItem(node: ProseMirrorNode) {
  return node.type.name === 'listItem' || node.type.name === 'taskItem'
}

/** 다른 종류의 목록을 내어쓴 뒤에도 바로 앞 목록의 마지막 항목 아래로 다시 넣을 수 있어야 한다. */
function indentFollowingList(state: EditorState, range: NodeRange, dispatch?: (tr: Transaction) => void) {
  if (range.startIndex !== 0) return false
  const { $from } = state.selection
  const depth = range.depth
  const index = $from.index(depth - 1)
  const previous = index > 0 ? $from.node(depth - 1).child(index - 1) : null
  const parent = previous?.lastChild
  const list = range.parent
  const selected = list.content.cut(0, range.end - $from.start(depth))
  const nested = list.copy(selected)
  if (!parent || !isListItem(parent) || !parent.canReplace(parent.childCount, parent.childCount, Fragment.from(nested))) return false
  if (dispatch) {
    const start = $from.before(depth)
    const remaining = list.content.cut(range.end - $from.start(depth))
    const firstNumber = typeof list.attrs.start === 'number' ? list.attrs.start : 1
    const attrs = list.type.name === 'orderedList' ? { ...list.attrs, start: firstNumber + range.endIndex } : list.attrs
    const tr = state.tr.replaceWith(start, start + list.nodeSize, remaining.size ? list.type.create(attrs, remaining) : Fragment.empty)
    const join = parent.lastChild?.type === list.type
    const target = start - (join ? 3 : 2)
    tr.insert(target, join ? selected : nested)
    const delta = target + (join ? 0 : 1) - range.start
    tr.setSelection(TextSelection.create(tr.doc, state.selection.anchor + delta, state.selection.head + delta))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** 종류가 다른 상위 목록에는 현재 항목을 직접 넣을 수 없다. 목록을 나눠 항목 종류와 완료 상태를 유지한다. */
function outdentMixedList(state: EditorState, range: NodeRange, dispatch?: (tr: Transaction) => void) {
  const { $from } = state.selection
  const depth = range.depth
  const inner = range.parent
  const parent = $from.node(depth - 1)
  const outer = $from.node(depth - 2)
  const innerStart = $from.start(depth)
  const parentStart = $from.start(depth - 1)
  const outerStart = $from.start(depth - 2)
  const before = inner.content.cut(0, range.start - innerStart)
  const after = inner.content.cut(range.end - innerStart)
  const parentBefore = parent.content.cut(0, $from.before(depth) - parentStart)
  const parentAfter = parent.content.cut($from.after(depth) - parentStart)
  const remainingParent = parent.copy(parentBefore.append(before.size ? Fragment.from(inner.copy(before)) : Fragment.empty))
  const left = outer.copy(outer.content.cut(0, $from.before(depth - 1) - outerStart).append(Fragment.from(remainingParent)))
  let selected = inner.content.cut(range.start - innerStart, range.end - innerStart)
  // 뒤에 있는 형제는 마지막 이동 항목의 자식으로 잇는다. 기본 liftListItem과 같은 읽기 순서를 유지한다.
  const last = selected.lastChild!
  let content = last.content
  if (after.size && last.lastChild?.type === inner.type) {
    content = content.replaceChild(content.childCount - 1, last.lastChild.copy(last.lastChild.content.append(after)))
  } else if (after.size) content = content.append(Fragment.from(inner.copy(after)))
  selected = selected.replaceChild(selected.childCount - 1, last.copy(content.append(parentAfter)))
  const right = outer.content.cut($from.after(depth - 1) - outerStart)
  const start = typeof outer.attrs.start === 'number' ? outer.attrs.start : 1
  const rightAttrs = outer.type.name === 'orderedList' ? { ...outer.attrs, start: start + $from.index(depth - 2) + 1 } : outer.attrs
  const replacement = Fragment.fromArray([left, inner.copy(selected), ...(right.size ? [outer.type.create(rightAttrs, right)] : [])])
  const outerPos = $from.before(depth - 2)
  const container = $from.node(depth - 3)
  const index = $from.index(depth - 3)
  if (!container.canReplace(index, index + 1, replacement)) return false
  if (dispatch) {
    const tr = state.tr.replaceWith(outerPos, outerPos + outer.nodeSize, replacement)
    const delta = outerPos + left.nodeSize + 1 - range.start
    tr.setSelection(TextSelection.create(tr.doc, state.selection.anchor + delta, state.selection.head + delta))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/** 기본 키맵은 혼합 목록에서 현재 항목 대신 바깥 taskItem/listItem을 찾기도 한다. 가장 가까운 항목만 처리한다. */
const MemoListIndentation = Extension.create({
  name: 'memoListIndentation',
  priority: 101,
  addCommands() {
    const changeIndent = (outdent: boolean) => () => ({ state, dispatch }: CommandProps) => {
      if (!this.editor.isEditable || this.editor.isActive('table') || this.editor.isActive('codeBlock')) return false
      const { selection } = state
      if (!(selection instanceof TextSelection)) return false
      const { $from, $to } = selection
      let itemDepth = $from.depth
      while (itemDepth > 0 && !isListItem($from.node(itemDepth))) itemDepth--
      if (itemDepth > 0) {
        // 목록의 설명 문단은 별도 블록이다. 내어쓸 때 부모 항목 전체를 옮기지 않는다.
        if ($from.depth === itemDepth + 1 && $from.index(itemDepth) > 0) {
          return outdent && $from.sameParent($to) && lift(state, dispatch)
        }
        const item = $from.node(itemDepth)
        const range = $from.blockRange($to, node => node === $from.node(itemDepth - 1))
        if (!range || range.depth !== itemDepth - 1) return false
        if (!outdent) {
          return sinkListItem(item.type)(state, dispatch) || indentFollowingList(state, range, dispatch)
        }
        else if (itemDepth > 2 && isListItem($from.node(itemDepth - 2))) {
          if ($from.node(itemDepth - 2).type === item.type && $from.node(itemDepth - 3).type === range.parent.type) return liftListItem(item.type)(state, dispatch)
          return outdentMixedList(state, range, dispatch)
        }
        // 더 들어갈 앞 항목이나 나올 상위가 없어도 서식을 지우거나 다른 항목으로 포커스를 넘기지 않는다.
        return false
      }
      if (outdent || !$from.sameParent($to) || !$from.parent.isTextblock) return false
      const previous = getPreviousBlockSibling($from)
      const lastItem = previous?.lastChild
      const block = $from.parent
      if (!lastItem || !isListItem(lastItem) || !lastItem.canReplace(lastItem.childCount, lastItem.childCount, Fragment.from(block))) return false
      if (dispatch) {
        const start = $from.before()
        const target = start - 2
        const tr = state.tr.delete(start, $from.after()).insert(target, block)
        const delta = target + 1 - $from.start()
        tr.setSelection(TextSelection.create(tr.doc, selection.anchor + delta, selection.head + delta))
        dispatch(tr.scrollIntoView())
      }
      return true
    }
    return { indentMemoList: changeIndent(false), outdentMemoList: changeIndent(true) }
  },
  addKeyboardShortcuts() {
    const change = (outdent: boolean) => {
      if (!this.editor.isEditable || this.editor.view.composing || this.editor.isActive('table') || this.editor.isActive('codeBlock')) return false
      if (!(this.editor.state.selection instanceof TextSelection)) return false
      const result = outdent ? this.editor.commands.outdentMemoList() : this.editor.commands.indentMemoList()
      // 목록 경계에서 서식이나 포커스를 바꾸지 않는다. Esc → Tab으로는 도구로 이동한다.
      const { $from } = this.editor.state.selection
      for (let depth = $from.depth; depth > 0; depth--) if (isListItem($from.node(depth))) return true
      return result
    }
    return { Tab: () => change(false), 'Shift-Tab': () => change(true) }
  },
})

/**
 * 메모 본문을 읽고 그리는 확장 — 편집기(MemoDocument)와 외부 공개 화면(/ext)이 같은 것을 쓴다. 둘이 다르면 같은 마크다운이
 * 다르게 보인다. editOnly 는 편집기만 쓰는 것(이미지 올리기 자리표시)이고, 원래 순서대로 이미지 앞에 둔다.
 */
export function memoExtensions(image: Pick<MemoImageOptions, 'toDisplay' | 'toStored'>, editOnly: AnyExtension[] = [], reference: Partial<MemoReferenceOptions> = {}): AnyExtension[] {
  return [
    HtmlUnderline,
    MemoInteractions,
    MemoListIndentation,
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: { checkboxLabel: (node, checked) => `${checked ? '완료' : '할 일'}: ${node.textContent || '빈 항목'}` },
    }),
    memoTableKit(),
    memoColumnsKit(),
    CodeBlockShiki.configure({
      defaultTheme: 'material-theme',
      themes: { light: 'material-theme-lighter', dark: 'material-theme-palenight' },
      enableTabIndentation: true,
    }),
    MemoEmoji,
    MemoReference.configure(reference),
    ...editOnly,
    MemoImage.configure(image),
  ]
}
