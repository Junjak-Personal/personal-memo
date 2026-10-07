/**
 * 폴더 구조 변경 대기열 — 메모·폴더 옮기기 3초, 폴더 이름 바꾸기 5초 (2026-10-07 사용자 요청).
 *
 * 사이드바는 바꾼 즉시 새 자리를 보여주고(applyStructureOps), 실제 파일 이동은 마지막 변경 뒤 그 시간만큼 기다렸다가
 * 쌓인 변경을 만든 순서대로 한꺼번에 한다. 그사이 더 바꾸면 기다림이 다시 시작된다.
 * 대기 중임을 사이드바에 보여주고 [취소] [지금 반영] 을 준다 — 조용히 기다리지 않는다.
 *
 * 열린 메모에 닿는 변경이면 먼저 그 메모를 저장하고, 반영 뒤 문서 화면을 새로 세운다 (useActiveMemo).
 * 하나라도 실패하면 남은 변경은 버리고 서버의 트리로 되돌린다 — 화면과 디스크가 어긋난 채 두지 않는다.
 */
import type { StructureOp } from '~/utils/tree-ops'

const DELAY_MS: Record<StructureOp['kind'], number> = {
  moveMemo: 3000,
  moveFolder: 3000,
  renameFolder: 5000,
}

// 타이머·진행 여부는 상태가 아니라 모듈 변수로 둔다 — SPA 라 화면 하나, 대기열 하나다
let timer: ReturnType<typeof setTimeout> | null = null
let dueAt = 0
let applying: Promise<boolean> | null = null

export function useStructureQueue() {
  const toast = useToast()
  const { tree, refresh } = useMemoTree()
  const activeMemo = useActiveMemo()

  const ops = useState<StructureOp[]>('structure-ops', () => [])

  /** 사이드바가 그리는 트리 — 서버 트리 + 대기 중인 변경 */
  const view = computed(() => applyStructureOps(tree.value, ops.value))

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
    dueAt = 0
  }

  function push(op: StructureOp) {
    ops.value = [...ops.value, op]
    // 마지막 변경 기준으로 다시 기다린다. 이름 바꾸기(5초)가 섞여 있으면 긴 쪽을 따른다
    dueAt = Math.max(dueAt, Date.now() + DELAY_MS[op.kind])
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void apply(), dueAt - Date.now())
  }

  function cancel() {
    clearTimer()
    ops.value = []
  }

  function touchesActive(op: StructureOp) {
    return op.kind === 'moveMemo' ? activeMemo.touches({ memoId: op.id }) : activeMemo.touches({ folder: op.path })
  }

  function run(op: StructureOp) {
    if (op.kind === 'moveMemo') {
      return $fetch(`/api/memos/${encodeURIComponent(op.id)}/move`, { method: 'POST', body: { folder: op.folder } })
    }
    if (op.kind === 'moveFolder') {
      return $fetch('/api/folders/move', { method: 'POST', body: { path: op.path, parent: op.parent } })
    }
    return $fetch('/api/folders', { method: 'PATCH', body: { path: op.path, name: op.name } })
  }

  /** 지금 반영한다. 앱을 내리거나 탭을 바꿀 때, 폴더를 만들거나 지우기 전에도 부른다 */
  function apply(): Promise<boolean> {
    applying ??= doApply().finally(() => {
      applying = null
    })
    return applying
  }

  async function doApply() {
    clearTimer()
    const batch = ops.value
    if (!batch.length) return true
    const affected = batch.some(touchesActive)
    if (affected && !(await activeMemo.flush())) {
      toast.add({ color: 'error', title: '열린 메모를 저장하지 못해서 폴더 구조 변경을 반영하지 않았습니다', description: '저장 상태를 확인한 뒤 「지금 반영」 을 누르세요.' })
      return false
    }
    let ok = true
    try {
      for (const op of batch) {
        await run(op)
        ops.value = ops.value.slice(1)
      }
    } catch (e) {
      ok = false
      ops.value = []
      toast.add({ color: 'error', title: apiMessage(e, '폴더 구조를 바꾸지 못했습니다'), description: '남은 변경은 취소하고 실제 폴더 상태로 되돌렸습니다.' })
    }
    await refresh()
    if (affected) activeMemo.reload()
    return ok
  }

  return { ops, view, push, cancel, apply }
}
