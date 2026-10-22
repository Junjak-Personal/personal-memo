import type { DropdownMenuItem } from '@nuxt/ui'
import type { MemoMeta, SearchHit } from '#shared/types/memo'
import { memoPath } from './memo-path'

/** 검색 순위/발췌는 유지하고, 이동·할 일 변경·휴지통 결과는 현재 트리에서 반영한다. */
export function currentSearchResults(hits: SearchHit[], memos: MemoMeta[] | null): SearchHit[] {
  if (!memos) return hits
  const current = new Map(memos.map(memo => [memo.id, memo]))
  return hits.flatMap(hit => {
    const memo = current.get(hit.id)
    // 외부 도구가 만든 메모는 검색에 먼저 나타날 수 있으므로 트리에 없다는 이유로 숨기지 않는다.
    return [{ ...hit, ...memo }]
  })
}

export type SearchResultMenuItem = DropdownMenuItem & { testId: string }
interface Actions {
  favorite: () => void
  copy: () => void
  todo: (done: boolean | null) => void
  move: () => void
  trash: () => void
}
interface State {
  favorite: boolean
  favoritePending: boolean
  todoPending: boolean
  removing: boolean
  desktop: boolean
}

export function searchResultMenu(memo: MemoMeta, state: State, actions: Actions): SearchResultMenuItem[][] {
  const busy = state.removing || state.todoPending
  const readonly = memo.unreadable || busy
  const open: SearchResultMenuItem[] = [{ label: '열기', icon: 'i-material-symbols-description-outline', to: memoPath(memo.id), testId: 'sidebar-search-open' }]
  if (state.desktop) open.push({ label: '새 탭에서 열기', icon: 'i-material-symbols-open-in-new', to: memoPath(memo.id), target: '_blank', rel: 'noopener noreferrer', testId: 'sidebar-search-open-tab' })
  const todo: SearchResultMenuItem[] = [{ label: memo.done === null ? '할 일로 두기' : '할 일 해제', icon: memo.done === null ? 'i-material-symbols-add-task' : 'i-material-symbols-remove-done', disabled: readonly, testId: 'sidebar-search-todo', onSelect: () => actions.todo(memo.done === null ? false : null) }]
  if (memo.done !== null) todo.unshift({ label: memo.done ? '미완료로 되돌리기' : '완료로 표시', icon: 'i-material-symbols-task-alt', disabled: readonly, testId: 'sidebar-search-complete', onSelect: () => actions.todo(!memo.done) })
  return [
    open,
    [
      { label: state.favorite ? '즐겨찾기 해제' : '즐겨찾기에 추가', icon: state.favorite ? 'i-material-symbols-star' : 'i-material-symbols-star-outline', disabled: readonly || state.favoritePending, testId: 'sidebar-search-favorite', onSelect: actions.favorite },
      { label: '메모 주소 복사', icon: 'i-material-symbols-link', testId: 'sidebar-search-copy', onSelect: actions.copy },
    ],
    todo,
    [{ label: '폴더 이동', icon: 'i-material-symbols-drive-file-move-outline', disabled: busy, testId: 'sidebar-search-move', onSelect: actions.move }],
    [{ label: '휴지통으로', icon: 'i-material-symbols-delete-outline', color: 'error', disabled: busy, testId: 'sidebar-search-trash', onSelect: actions.trash }],
  ]
}
