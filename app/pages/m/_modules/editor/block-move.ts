import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { closeHistory } from '@tiptap/pm/history'
import { Selection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

export interface TopLevelBlock {
  index: number
  pos: number
  nodeSize: number
  type: string
  label: string
}

export interface BlockRect {
  top: number
  bottom: number
}

const BLOCK_NAMES: Record<string, string> = {
  paragraph: '문단',
  heading: '제목',
  bulletList: '글머리 목록',
  orderedList: '번호 목록',
  taskList: '할 일 목록',
  blockquote: '인용',
  codeBlock: '코드',
  table: '표',
  image: '이미지',
  horizontalRule: '구분선',
}

export function getTopLevelBlocks(doc: ProseMirrorNode): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = []
  // 최상위만 나열해야 목록 항목이나 표의 셀이 따로 떨어져 나가지 않는다.
  doc.forEach((node, pos, index) => {
    const name = BLOCK_NAMES[node.type.name] ?? '블록'
    const summary = node.textBetween(0, node.content.size, ' ').replace(/\s+/g, ' ').trim() || String(node.attrs.alt ?? '').trim()
    blocks.push({ index, pos, nodeSize: node.nodeSize, type: node.type.name, label: summary ? `${name}: ${summary.slice(0, 60)}` : name })
  })
  return blocks
}

/** insertionIndex는 이동 전 문서의 블록 사이 경계(0..childCount)다. */
export function moveBlockTransaction(state: EditorState, fromIndex: number, insertionIndex: number): Transaction | null {
  const { doc, selection } = state
  if (!Number.isInteger(fromIndex) || !Number.isInteger(insertionIndex)
    || fromIndex < 0 || fromIndex >= doc.childCount || insertionIndex < 0 || insertionIndex > doc.childCount
    || insertionIndex === fromIndex || insertionIndex === fromIndex + 1) return null

  const blocks = getTopLevelBlocks(doc)
  const source = blocks[fromIndex]!
  const node = doc.child(fromIndex)
  const boundary = insertionIndex === doc.childCount ? doc.content.size : blocks[insertionIndex]!.pos
  const insertPos = boundary > source.pos ? boundary - source.nodeSize : boundary

  // 삭제와 삽입을 한 transaction에 넣어 자동 저장·실행 취소에 중간 문서가 드러나지 않는다.
  const tr = closeHistory(state.tr).delete(source.pos, source.pos + source.nodeSize).insert(insertPos, node)
  if (selection.from >= source.pos && selection.to <= source.pos + source.nodeSize) {
    // 기본 삭제 mapping은 이동한 내용 안의 커서를 잃으므로 블록 내 상대 위치를 복원한다.
    const offset = insertPos - source.pos
    const original = selection.toJSON() as { type: string; anchor?: number; head?: number }
    tr.setSelection(Selection.fromJSON(tr.doc, {
      ...original,
      ...(typeof original.anchor === 'number' ? { anchor: original.anchor + offset } : {}),
      ...(typeof original.head === 'number' ? { head: original.head + offset } : {}),
    }))
  }
  return tr
}

export function blockInsertionIndex(pointerY: number, rects: readonly BlockRect[]): number {
  const index = rects.findIndex(rect => pointerY < (rect.top + rect.bottom) / 2)
  return index < 0 ? rects.length : index
}

/** 화면 가장자리에서만 스크롤하고, 짧은 화면에서는 양쪽 가장자리 영역이 겹치지 않게 한다. */
export function blockEdgeScrollDelta(pointerY: number, viewport: BlockRect, edgeSize = 64, maxSpeed = 16): number {
  const edge = Math.min(edgeSize, (viewport.bottom - viewport.top) / 2)
  if (edge <= 0 || maxSpeed <= 0 || !Number.isFinite(pointerY)) return 0
  if (pointerY < viewport.top + edge) return -maxSpeed * Math.min(1, Math.max(0, (viewport.top + edge - pointerY) / edge))
  if (pointerY > viewport.bottom - edge) return maxSpeed * Math.min(1, Math.max(0, (pointerY - viewport.bottom + edge) / edge))
  return 0
}
