/**
 * 사이드바 트리 끌어 놓기 (PC) — 메모·폴더를 다른 폴더나 최상위로 옮기고, 같은 폴더 안 순서를 바꾼다.
 *
 * 브라우저 기본 끌어 놓기(HTML5)를 쓴다. Nuxt UI 공식 예제(SortableJS)는 같은 목록 안 «순서 바꾸기»만 해서
 * 다른 폴더 «안으로» 넣기와 같이 쓸 수 없다. 줄 위에서 놓는 자리:
 * - 같은 폴더의 같은 종류(메모↔메모, 폴더↔폴더) 줄의 위·아래 가장자리 → 그 앞·뒤로 순서 (설계문서 §3.6, 2026-10-17)
 *   메모 줄은 위 절반·아래 절반, 폴더 줄은 위 1/4·아래 1/4 — 가운데는 «그 폴더 안으로» 를 위해 남긴다.
 * - 폴더 줄 가운데 → 그 폴더 안으로 옮기기
 * 터치 끌기는 iOS 웹뷰에서 믿을 수 없어 폰은 메뉴(다른 폴더로 옮기기, 위로·아래로)로 한다.
 *
 * 옮기기는 트리에 바로 보이고 실제 파일 이동은 3초 뒤 대기열이 한다 (useStructureQueue). 순서는 바로 저장한다.
 * 「할 일」 폴더 (2026-10-22): 메모는 넣고 뺄 수 있지만(할 일이 되고 풀린다) 안의 순서는 날짜·중요도순이라 바꾸지 않는다.
 * 그 폴더 자체는 옮기지 않고, 그 안에 폴더를 넣지 않는다 (서버도 거절).
 */
import { TODO_FOLDER } from '#shared/utils/todo'

export type Dragged =
  | { kind: 'memo'; id: string; folder: string; label: string }
  | { kind: 'folder'; path: string; label: string }

/** 끌고 있는 것 아래의 줄 */
export type RowTarget = { kind: 'memo'; id: string; folder: string } | { kind: 'folder'; path: string }

/** 순서로 놓을 자리 — key 는 메모 id 나 폴더 경로 */
export interface OrderSlot {
  key: string
  place: 'before' | 'after'
}

interface Options {
  /** from — 옮긴 폴더의 원래 경로(메모면 null), to — 새 경로(메모면 옮겨 간 폴더) */
  onRelocated: (from: string | null, to: string) => void
  onReorder: (dragged: Dragged, slot: OrderSlot) => void
  /** 순서를 바꿀 수 없는 줄 — 최상위의 「할 일」 폴더는 늘 맨 위다 */
  pinned: (key: string) => boolean
}

export function useTreeDragDrop({ onRelocated, onReorder, pinned }: Options) {
  const queue = useStructureQueue()

  const dragging = ref<Dragged | null>(null)
  /** 놓을 자리로 표시 중인 폴더(그 안으로). 최상위는 '' */
  const over = ref<string | null>(null)
  /** 놓을 자리로 표시 중인 순서 자리 */
  const slot = ref<OrderSlot | null>(null)

  function keyOf(item: Dragged | RowTarget) {
    return item.kind === 'memo' ? item.id : item.path
  }

  function parentKeyOf(item: Dragged | RowTarget) {
    return item.kind === 'memo' ? item.folder : parentOf(item.path)
  }

  /** 제자리, 자기 자신, 자기 하위 폴더로는 못 놓는다. 「할 일」 폴더는 옮기지 않고, 그 안에 폴더를 넣지 않는다 */
  function canDrop(folder: string) {
    const d = dragging.value
    if (!d) return false
    if (d.kind === 'memo') return folder !== d.folder
    if (d.path === TODO_FOLDER || folder === TODO_FOLDER || (!folder && d.label === TODO_FOLDER)) return false
    return folder !== parentOf(d.path) && folder !== d.path && !folder.startsWith(`${d.path}/`)
  }

  /** 같은 폴더 안의 같은 종류끼리만 */
  function canReorder(target: RowTarget) {
    const d = dragging.value
    if (!d || d.kind !== target.kind || keyOf(d) === keyOf(target)) return false
    return parentKeyOf(d) === parentKeyOf(target) && parentKeyOf(target) !== TODO_FOLDER && !pinned(keyOf(d)) && !pinned(keyOf(target))
  }

  function start(event: DragEvent, dragged: Dragged) {
    dragging.value = dragged
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', dragged.label)
  }

  /** 놓기를 허락하려면 dragover 마다 preventDefault 해야 한다 */
  function accept(event: DragEvent) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  /** dragenter·dragover 둘 다 — 폴더(또는 최상위 자리) 안으로 */
  function enter(event: DragEvent, folder: string) {
    if (!canDrop(folder)) return
    accept(event)
    over.value = folder
  }

  /** 줄 위에서 — 위·아래 가장자리는 순서, 폴더 줄 가운데는 그 안으로 */
  function overRow(event: DragEvent, target: RowTarget) {
    const row = event.currentTarget
    if (!(row instanceof HTMLElement)) return
    const rect = row.getBoundingClientRect()
    const y = (event.clientY - rect.top) / rect.height
    const edge = target.kind === 'folder' ? 0.25 : 0.5
    if (canReorder(target) && (y < edge || y >= 1 - edge)) {
      accept(event)
      slot.value = { key: keyOf(target), place: y < edge ? 'before' : 'after' }
      over.value = null
      return
    }
    slot.value = null
    if (target.kind === 'folder') enter(event, target.path)
    else over.value = null
  }

  function leave(folder: string) {
    if (over.value === folder) over.value = null
  }

  function leaveRow(target: RowTarget) {
    if (slot.value?.key === keyOf(target)) slot.value = null
    if (target.kind === 'folder') leave(target.path)
  }

  function end() {
    dragging.value = null
    over.value = null
    slot.value = null
  }

  function drop(event: DragEvent, folder: string) {
    event.preventDefault()
    const dragged = dragging.value
    const allowed = canDrop(folder)
    end()
    if (!dragged || !allowed) return
    if (dragged.kind === 'memo') {
      queue.push({ kind: 'moveMemo', id: dragged.id, title: dragged.label, folder })
      onRelocated(null, folder)
    } else {
      queue.push({ kind: 'moveFolder', path: dragged.path, parent: folder })
      onRelocated(dragged.path, folder ? `${folder}/${dragged.label}` : dragged.label)
    }
  }

  function dropRow(event: DragEvent, target: RowTarget) {
    const dragged = dragging.value
    const at = slot.value
    if (dragged && at) {
      event.preventDefault()
      end()
      onReorder(dragged, at)
      return
    }
    if (target.kind === 'folder') drop(event, target.path)
    else end()
  }

  return { dragging, over, slot, canDrop, start, enter, overRow, leave, leaveRow, end, drop, dropRow }
}
