import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface MemoFindMatch { from: number; to: number }
export interface MemoFindState {
  query: string
  caseSensitive: boolean
  matches: MemoFindMatch[]
  limited: boolean
  activeIndex: number
  decorations: DecorationSet
}
type MemoFindAction = { type: 'search'; query: string; caseSensitive: boolean } | { type: 'active'; index: number }

export const MAX_MEMO_FIND_MATCHES = 2000
export const memoFindKey = new PluginKey<MemoFindState>('memo-find')

/** 텍스트 서식 경계는 검색하되 문단·줄바꿈·참조 atom을 가로질러 일치시키지 않는다. */
export function findMemoText(doc: ProseMirrorNode, query: string, caseSensitive = false) {
  const matches: MemoFindMatch[] = []
  if (!query) return { matches, limited: false }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(escaped, caseSensitive ? 'gu' : 'giu')
  let limited = false
  function search(text: string, from: number) {
    for (const match of text.matchAll(expression)) {
      if (matches.length === MAX_MEMO_FIND_MATCHES) { limited = true; break }
      matches.push({ from: from + match.index, to: from + match.index + match[0].length })
    }
  }
  doc.descendants((node, pos) => {
    if (limited) return false
    if (!node.isTextblock) return
    let text = ''
    let start = pos + 1
    node.forEach((child, offset) => {
      if (limited) return
      if (child.isText) {
        if (!text) start = pos + 1 + offset
        text += child.text ?? ''
      } else {
        search(text, start)
        text = ''
      }
    })
    if (!limited) search(text, start)
    return false
  })
  return { matches, limited }
}

function decorate(doc: ProseMirrorNode, matches: MemoFindMatch[], activeIndex: number) {
  return DecorationSet.create(doc, matches.map((match, index) => Decoration.inline(match.from, match.to, {
    class: index === activeIndex ? 'bg-primary/30 outline outline-1 outline-primary rounded-xs' : 'bg-amber-200/60 dark:bg-amber-500/30 rounded-xs',
    'data-memo-find': index === activeIndex ? 'active' : 'match',
  })))
}

export function memoFindPlugin() {
  return new Plugin<MemoFindState>({
    key: memoFindKey,
    state: {
      init: () => ({ query: '', caseSensitive: false, matches: [], limited: false, activeIndex: -1, decorations: DecorationSet.empty }),
      apply(tr, previous) {
        const action = tr.getMeta(memoFindKey) as MemoFindAction | undefined
        if (!tr.docChanged && !action) return previous
        const query = action?.type === 'search' ? action.query : previous.query
        const caseSensitive = action?.type === 'search' ? action.caseSensitive : previous.caseSensitive
        const result = tr.docChanged || action?.type === 'search' ? findMemoText(tr.doc, query, caseSensitive) : previous
        const requested = action?.type === 'active' ? action.index : action?.type === 'search' ? 0 : previous.activeIndex
        const activeIndex = result.matches.length ? Math.max(0, Math.min(requested, result.matches.length - 1)) : -1
        return { query, caseSensitive, ...result, activeIndex, decorations: decorate(tr.doc, result.matches, activeIndex) }
      },
    },
    props: { decorations: state => memoFindKey.getState(state)?.decorations },
  })
}

export function searchMemoTransaction(state: EditorState, query: string, caseSensitive: boolean) {
  return state.tr.setMeta(memoFindKey, { type: 'search', query, caseSensitive } satisfies MemoFindAction).setMeta('addToHistory', false)
}

export function selectMemoMatch(state: EditorState, index: number) {
  const search = memoFindKey.getState(state)
  const match = search?.matches[index]
  if (!match) return null
  return state.tr.setSelection(TextSelection.create(state.doc, match.from, match.to))
    .setMeta(memoFindKey, { type: 'active', index } satisfies MemoFindAction).setMeta('addToHistory', false).scrollIntoView()
}

/** 모든 교체를 한 transaction에 담고 뒤에서부터 바꿔 원래 위치와 주변 서식을 보존한다. */
export function replaceMemoMatches(state: EditorState, matches: readonly MemoFindMatch[], replacement: string) {
  if (!matches.length) return null
  for (const match of matches) {
    if (match.from < 0 || match.to > state.doc.content.size || match.from >= match.to) return null
    const $from = state.doc.resolve(match.from)
    const $to = state.doc.resolve(match.to)
    if (!$from.sameParent($to) || !$from.parent.isTextblock) return null
    let textOnly = true
    state.doc.nodesBetween(match.from, match.to, node => { if (node.isInline && !node.isText) textOnly = false })
    if (!textOnly) return null
  }
  const ordered = [...matches].sort((left, right) => right.from - left.from)
  if (ordered.some((match, index) => index > 0 && match.to > ordered[index - 1]!.from)) return null
  const tr = closeHistory(state.tr)
  for (const match of ordered) tr.insertText(replacement, match.from, match.to)
  return tr.scrollIntoView()
}
