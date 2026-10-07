/**
 * 사이드바 트리 끌어 놓기 (PC) — 메모·폴더를 다른 폴더나 최상위로 옮긴다.
 *
 * 브라우저 기본 끌어 놓기(HTML5)를 쓴다. Nuxt UI 공식 예제(SortableJS)는 같은 목록 안 «순서 바꾸기»라
 * 다른 폴더 «안으로» 넣는 데는 맞지 않는다. 같은 폴더 안 순서는 바꾸지 않는다 — 파일시스템에는 순서가 없고
 * 목록은 최근 수정순이다. 터치 끌기는 iOS 웹뷰에서 믿을 수 없어 폰은 메뉴(다른 폴더로 옮기기)로 옮긴다.
 *
 * 놓으면 트리에는 바로 보이고, 실제 파일 이동은 3초 뒤 대기열이 한다 (useStructureQueue).
 */
export type Dragged =
  | { kind: 'memo'; id: string; folder: string; label: string }
  | { kind: 'folder'; path: string; label: string }

/** from — 옮긴 폴더의 원래 경로(메모면 null), to — 새 경로(메모면 옮겨 간 폴더) */
export function useTreeDragDrop(onRelocated: (from: string | null, to: string) => void) {
  const queue = useStructureQueue()

  const dragging = ref<Dragged | null>(null)
  /** 놓을 자리로 표시 중인 폴더. 최상위는 '' */
  const over = ref<string | null>(null)

  /** 제자리, 자기 자신, 자기 하위 폴더로는 못 놓는다 */
  function canDrop(folder: string) {
    const d = dragging.value
    if (!d) return false
    if (d.kind === 'memo') return folder !== d.folder
    return folder !== parentOf(d.path) && folder !== d.path && !folder.startsWith(`${d.path}/`)
  }

  function start(event: DragEvent, dragged: Dragged) {
    dragging.value = dragged
    if (!event.dataTransfer) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', dragged.label)
  }

  /** dragenter·dragover 둘 다 — 놓기를 허락하려면 dragover 마다 preventDefault 해야 한다 */
  function enter(event: DragEvent, folder: string) {
    if (!canDrop(folder)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    over.value = folder
  }

  function leave(folder: string) {
    if (over.value === folder) over.value = null
  }

  function end() {
    dragging.value = null
    over.value = null
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

  return { dragging, over, canDrop, start, enter, leave, end, drop }
}
