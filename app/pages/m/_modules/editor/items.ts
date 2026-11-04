/**
 * 에디터 메뉴 항목 — nuxt-ui-templates/editor (MIT, 커밋 4101ecc) 의 useEditorToolbar·useEditorSuggestions·
 * useEditorDragHandle 을 옮겨 왔다. 바꾼 것: 한국어 이름, material-symbols 아이콘, 멘션·AI 제거,
 * 슬래시 메뉴에 영어 키워드(`/h1`, `/table`) — 모바일에서 한글로 바꾸지 않고도 찾게.
 */
import type { DropdownMenuItem, EditorCustomHandlers, EditorSuggestionMenuItem, EditorToolbarItem } from '@nuxt/ui'
import { mapEditorItems } from '@nuxt/ui/utils/editor'
import type {} from '@tiptap/extension-table'
import type { Editor, JSONContent } from '@tiptap/vue-3'
import type {} from '~/utils/editor-columns'

/** 「바꾸기」 대상 — 슬래시 메뉴·말풍선 툴바·끌기 손잡이가 같은 목록을 쓴다 */
const BLOCK_TYPES = [
  { kind: 'paragraph', label: '본문', icon: 'i-material-symbols-format-paragraph', keywords: ['p', 'text', '텍스트'] },
  { kind: 'heading', level: 1, label: '제목 1', icon: 'i-material-symbols-format-h1', keywords: ['h1', 'heading'] },
  { kind: 'heading', level: 2, label: '제목 2', icon: 'i-material-symbols-format-h2', keywords: ['h2', 'heading'] },
  { kind: 'heading', level: 3, label: '제목 3', icon: 'i-material-symbols-format-h3', keywords: ['h3', 'heading'] },
  { kind: 'heading', level: 4, label: '제목 4', icon: 'i-material-symbols-format-h4', keywords: ['h4', 'heading'] },
  { kind: 'bulletList', label: '글머리 목록', icon: 'i-material-symbols-format-list-bulleted', keywords: ['ul', 'list', '목록'] },
  { kind: 'orderedList', label: '번호 목록', icon: 'i-material-symbols-format-list-numbered', keywords: ['ol', 'number', '목록'] },
  { kind: 'taskList', label: '체크리스트', icon: 'i-material-symbols-checklist', keywords: ['todo', 'task', '할일'] },
  { kind: 'blockquote', label: '인용', icon: 'i-material-symbols-format-quote-outline', keywords: ['quote'] },
  { kind: 'codeBlock', label: '코드 블록', icon: 'i-material-symbols-code-blocks-outline', keywords: ['code'] },
] as const

const CONVERTIBLE = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'listItem', 'taskItem']

/** 같은 열 선택을 상단 툴바와 `/` 메뉴에서 사용한다. */
const COLUMN_TYPES = [
  { kind: 'columns2', label: '2열', icon: 'i-material-symbols-view-column-outline', keywords: ['columns', 'column', 'cols', '2col', '2열'], 'data-testid': 'memo-columns-select-2' },
  { kind: 'columns3', label: '3열', icon: 'i-material-symbols-view-column-outline', keywords: ['columns', 'column', 'cols', '3col', '3열'], 'data-testid': 'memo-columns-select-3' },
  { kind: 'columns4', label: '4열', icon: 'i-material-symbols-view-column-outline', keywords: ['columns', 'column', 'cols', '4col', '4열'], 'data-testid': 'memo-columns-select-4' },
] as const

const NODE_LABELS: Record<string, string> = {
  paragraph: '본문',
  heading: '제목',
  bulletList: '글머리 목록',
  orderedList: '번호 목록',
  taskList: '체크리스트',
  listItem: '목록 항목',
  taskItem: '체크 항목',
  blockquote: '인용',
  codeBlock: '코드 블록',
  image: '이미지',
  table: '표',
  memoColumns: '열 배치',
  memoColumn: '열',
  horizontalRule: '구분선',
}

function columnHandler(count: 2 | 3 | 4) {
  return {
    canExecute: (editor: Editor) => editor.can().setMemoColumns(count),
    execute: (editor: Editor) => editor.chain().focus().setMemoColumns(count),
    isActive: (editor: Editor) => editor.isActive('memoColumns', { count }),
    isDisabled: undefined,
  }
}

/** 이미지 올리기·표 넣기 — 템플릿과 같은 사용자 정의 명령 */
export const customHandlers = {
  imageUpload: {
    canExecute: (editor: Editor) => editor.can().insertContent({ type: 'imageUpload' }),
    execute: (editor: Editor) => editor.chain().focus().insertContent({ type: 'imageUpload' }),
    isActive: (editor: Editor) => editor.isActive('imageUpload'),
    isDisabled: undefined,
  },
  table: {
    canExecute: (editor: Editor) => editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    execute: (editor: Editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
    isActive: (editor: Editor) => editor.isActive('table'),
    isDisabled: undefined,
  },
  columns2: columnHandler(2),
  columns3: columnHandler(3),
  columns4: columnHandler(4),
  columnsUnset: {
    canExecute: (editor: Editor) => editor.can().unsetMemoColumns(),
    execute: (editor: Editor) => editor.chain().focus().unsetMemoColumns(),
    isActive: () => false,
    isDisabled: undefined,
  },
} satisfies EditorCustomHandlers

type Handlers = typeof customHandlers

/** 위 줄에 늘 떠 있는 툴바 */
export const toolbarItems: (EditorToolbarItem<Handlers> & { 'data-testid'?: string })[][] = [
  [
    { kind: 'heading', level: 1, icon: 'i-material-symbols-format-h1', tooltip: { text: '제목 1' } },
    { kind: 'heading', level: 2, icon: 'i-material-symbols-format-h2', tooltip: { text: '제목 2' } },
    { kind: 'heading', level: 3, icon: 'i-material-symbols-format-h3', tooltip: { text: '제목 3' } },
  ],
  [
    { kind: 'mark', mark: 'bold', icon: 'i-material-symbols-format-bold', tooltip: { text: '굵게' } },
    { kind: 'mark', mark: 'underline', icon: 'i-material-symbols-format-underlined', tooltip: { text: '밑줄' } },
  ],
  [{ kind: 'imageUpload', icon: 'i-material-symbols-image-outline', tooltip: { text: '이미지' } }],
  [
    {
      icon: 'i-material-symbols-view-column-outline',
      tooltip: { text: '열 배치' },
      'data-testid': 'memo-columns-menu-open',
      content: { align: 'start' },
      items: [
        COLUMN_TYPES.map(({ keywords: _, ...item }) => item),
        [{ kind: 'columnsUnset', label: '열 해제', icon: 'i-material-symbols-view-agenda-outline', 'data-testid': 'memo-columns-unset' }],
      ],
    },
  ],
  [
    { kind: 'undo', icon: 'i-material-symbols-undo', tooltip: { text: '실행 취소' } },
    { kind: 'redo', icon: 'i-material-symbols-redo', tooltip: { text: '다시 실행' } },
  ],
]

/** 글자를 고르면 뜨는 말풍선 툴바 */
export const bubbleToolbarItems = [
  [
    {
      label: '바꾸기',
      trailingIcon: 'i-material-symbols-keyboard-arrow-down',
      activeColor: 'neutral',
      activeVariant: 'ghost',
      tooltip: { text: '블록 종류 바꾸기' },
      content: { align: 'start' },
      ui: { label: 'text-xs' },
      items: [{ type: 'label', label: '바꾸기' }, ...BLOCK_TYPES.map(({ keywords: _, ...item }) => item)],
    },
  ],
  [
    { kind: 'mark', mark: 'bold', icon: 'i-material-symbols-format-bold', tooltip: { text: '굵게' } },
    { kind: 'mark', mark: 'italic', icon: 'i-material-symbols-format-italic', tooltip: { text: '기울임' } },
    { kind: 'mark', mark: 'underline', icon: 'i-material-symbols-format-underlined', tooltip: { text: '밑줄' } },
    { kind: 'mark', mark: 'strike', icon: 'i-material-symbols-strikethrough-s', tooltip: { text: '취소선' } },
    { kind: 'mark', mark: 'code', icon: 'i-material-symbols-code', tooltip: { text: '코드' } },
  ],
  [
    { slot: 'link' as const, icon: 'i-material-symbols-link' },
    { kind: 'imageUpload', icon: 'i-material-symbols-image-outline', tooltip: { text: '이미지' } },
  ],
] satisfies EditorToolbarItem<Handlers>[][]

/** `/` 메뉴 */
export const suggestionItems = [
  [{ type: 'label', label: '블록' }, ...BLOCK_TYPES],
  [
    { type: 'label', label: '넣기' },
    { kind: 'emoji', label: '이모지', icon: 'i-material-symbols-add-reaction-outline', keywords: ['emoji'] },
    { kind: 'imageUpload', label: '이미지', icon: 'i-material-symbols-image-outline', keywords: ['image', 'img', '사진'] },
    { kind: 'table', label: '표', icon: 'i-material-symbols-table-outline', keywords: ['table'] },
    ...COLUMN_TYPES,
    { kind: 'horizontalRule', label: '구분선', icon: 'i-material-symbols-horizontal-rule', keywords: ['hr', 'line', '선'] },
  ],
] satisfies EditorSuggestionMenuItem<Handlers>[][]

/** 이미지를 고르면 뜨는 툴바 */
export function imageToolbarItems(editor: Editor, actions: { showOriginal: (src: string) => void }): EditorToolbarItem<Handlers>[][] {
  const pos = editor.state.selection.from
  const node = editor.state.doc.nodeAt(pos)
  const isImage = node?.type.name === 'image'
  return [
    [
      {
        icon: 'i-material-symbols-open-in-full',
        tooltip: { text: '원본 보기' },
        onClick: () => {
          if (isImage && typeof node.attrs.src === 'string') actions.showOriginal(node.attrs.src)
        },
      },
    ],
    [
      {
        icon: 'i-material-symbols-sync',
        tooltip: { text: '바꾸기' },
        onClick: () => {
          if (isImage) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).insertContentAt(pos, { type: 'imageUpload' }).run()
        },
      },
    ],
    [
      {
        icon: 'i-material-symbols-delete-outline',
        tooltip: { text: '지우기' },
        onClick: () => {
          if (isImage) editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
        },
      },
    ],
  ]
}

/** 표 칸을 고르면 뜨는 툴바 — 행·열 추가/삭제 */
export function tableToolbarItems(editor: Editor): EditorToolbarItem<Handlers>[][] {
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => fn(editor.chain().focus()).run()
  return [
    [
      { icon: 'i-material-symbols-add-row-above-outline', tooltip: { text: '위에 행 추가' }, onClick: run((c) => c.addRowBefore()) },
      { icon: 'i-material-symbols-add-row-below-outline', tooltip: { text: '아래에 행 추가' }, onClick: run((c) => c.addRowAfter()) },
      { icon: 'i-material-symbols-add-column-left-outline', tooltip: { text: '왼쪽에 열 추가' }, onClick: run((c) => c.addColumnBefore()) },
      { icon: 'i-material-symbols-add-column-right-outline', tooltip: { text: '오른쪽에 열 추가' }, onClick: run((c) => c.addColumnAfter()) },
    ],
    [
      { icon: 'i-material-symbols-variable-remove-outline', tooltip: { text: '행 삭제' }, onClick: run((c) => c.deleteRow()) },
      { icon: 'i-material-symbols-view-column-outline', tooltip: { text: '열 삭제' }, onClick: run((c) => c.deleteColumn()) },
    ],
    [{ icon: 'i-material-symbols-delete-outline', tooltip: { text: '표 삭제' }, onClick: run((c) => c.deleteTable()) }],
  ]
}

/** 끌기 손잡이(⠿) 메뉴 */
export function dragHandleItems(editor: Editor, selected: { node: JSONContent | null; pos: number } | undefined): DropdownMenuItem[][] {
  const type = selected?.node?.type
  if (!type) return []
  const pos = selected.pos
  const specific: DropdownMenuItem[] = CONVERTIBLE.includes(type)
    ? [
        { label: '바꾸기', icon: 'i-material-symbols-swap-horiz', children: BLOCK_TYPES.map(({ keywords: _, ...item }) => item) },
        { kind: 'clearFormatting', pos, label: '서식 지우기', icon: 'i-material-symbols-format-clear' },
      ]
    : []
  return mapEditorItems(
    editor,
    [
      [{ type: 'label', label: NODE_LABELS[type] ?? type }, ...specific],
      [
        { kind: 'duplicate', pos, label: '복제', icon: 'i-material-symbols-content-copy-outline' },
        {
          label: '글자 복사',
          icon: 'i-material-symbols-content-paste',
          onSelect: async () => {
            const node = editor.state.doc.nodeAt(pos)
            if (node) await navigator.clipboard.writeText(node.textContent)
          },
        },
      ],
      [
        { kind: 'moveUp', pos, label: '위로', icon: 'i-material-symbols-arrow-upward' },
        { kind: 'moveDown', pos, label: '아래로', icon: 'i-material-symbols-arrow-downward' },
      ],
      [{ kind: 'delete', pos, label: '삭제', icon: 'i-material-symbols-delete-outline', color: 'error' }],
    ],
    customHandlers,
  ) as DropdownMenuItem[][]
}
