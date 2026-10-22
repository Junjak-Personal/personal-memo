import type { Memo, MemoMeta, TodoPriority } from '#shared/types/memo'
import { TODO_FOLDER } from '#shared/utils/todo'

/**
 * 할 일 (설계문서 §3.5) — 체크, 중요도, 할 일로 두기/풀기, 새 할 일. 사이드바·「할 일」 화면·메모 화면이 같이 쓴다.
 *
 * 상태의 원본은 사이드바 트리(useMemoTree) 하나다. 체크하면 트리의 그 메모를 먼저 바꾸고(바로 보이게) 서버가 거절하면
 * 되돌린다. 열린 편집기와 따로 맞출 것은 없다 — 서버가 버전을 done·priority 줄을 빼고 재서 편집기의 다음 저장이 막히지 않는다.
 * 할 일로 두면 서버가 「할 일」 폴더로, 풀면 최상위로 옮긴다 (2026-10-22) — 트리도 그 자리로 미리 옮긴다.
 */
export function useTodo() {
  const toast = useToast()
  const { tree, refresh } = useMemoTree()
  const calendarSync = useCalendarSyncStatus()
  const activeMemo = useActiveMemo()
  const queue = useStructureQueue()
  /** 서버에 보내는 중인 메모 — 응답이 오기 전에 또 누르면 순서가 뒤섞이므로 그동안은 막는다 */
  const pending = useState<string[]>('todo-pending', () => [])

  function find(id: string) {
    return tree.value?.memos.find((m) => m.id === id) ?? null
  }

  function patchTree(id: string, patch: Partial<MemoMeta>) {
    const memos = tree.value?.memos
    const index = memos?.findIndex((m) => m.id === id) ?? -1
    if (memos && index !== -1) memos[index] = { ...memos[index]!, ...patch }
  }

  /** 서버(MemoStore.setDone)와 같은 규칙 — 할 일은 「할 일」 폴더로, 풀면 최상위로 옮기고 중요도를 지운다 */
  function placeOf(memo: MemoMeta, done: boolean | null): Partial<MemoMeta> {
    const folder = done === null ? (memo.folder === TODO_FOLDER ? '' : memo.folder) : TODO_FOLDER
    const name = memo.path.slice(memo.path.lastIndexOf('/') + 1)
    return { done, priority: done === null ? 'medium' : memo.priority, folder, path: folder ? `${folder}/${name}` : name }
  }

  /**
   * done: true = 끝냄, false = 할 일(안 끝남), null = 할 일 해제.
   * 폴더가 바뀌는 경우(할 일로 두기·해제)는 폴더 이동과 같다 — 대기 중인 구조 변경을 먼저 반영하고, 열린 메모면 먼저 저장하고
   * 끝나면 문서 화면을 새로 세운다 (이미지 주소가 연 순간의 폴더 기준이라서 — useActiveMemo).
   */
  async function setDone(id: string, done: boolean | null) {
    if (pending.value.includes(id)) return false
    pending.value = [...pending.value, id]
    let before: MemoMeta | null = null
    try {
      const current = find(id)
      const moves = current !== null && placeOf(current, done).folder !== current.folder
      if (moves) {
        if (!(await queue.apply())) return false
        if (activeMemo.touches({ memoId: id }) && !(await activeMemo.flush())) {
          toast.add({ color: 'error', title: '열린 메모를 저장하지 못해서 옮기지 않았습니다', description: '저장 상태를 먼저 확인하세요.' })
          return false
        }
      }
      before = find(id)
      if (before) patchTree(id, placeOf(before, done))
      const meta = await $fetch<MemoMeta>(`/api/memos/${encodeURIComponent(id)}/done`, { method: 'PATCH', body: { done } })
      patchTree(id, meta)
      if (moves && activeMemo.isOpen(id)) activeMemo.reload()
      // 날짜 있는 할 일이면 구글 일정이 지워지거나 다시 생긴다 — 반영 실패 표시를 잠시 뒤 다시 본다
      if (meta.date) calendarSync.recheckSoon()
      return true
    } catch (e) {
      if (before) patchTree(id, before)
      toast.add({ color: 'error', title: apiMessage(e, '할 일을 바꾸지 못했습니다') })
      return false
    } finally {
      pending.value = pending.value.filter((p) => p !== id)
    }
  }

  /** 중요도 — 체크처럼 트리를 먼저 바꾸고 서버가 거절하면 되돌린다 */
  async function setPriority(id: string, priority: TodoPriority) {
    const before = find(id)
    if (!before || before.priority === priority || pending.value.includes(id)) return
    pending.value = [...pending.value, id]
    patchTree(id, { priority })
    try {
      patchTree(id, await $fetch<MemoMeta>(`/api/memos/${encodeURIComponent(id)}/priority`, { method: 'PATCH', body: { priority } }))
    } catch (e) {
      patchTree(id, { priority: before.priority })
      toast.add({ color: 'error', title: apiMessage(e, '중요도를 바꾸지 못했습니다') })
    } finally {
      pending.value = pending.value.filter((p) => p !== id)
    }
  }

  /** 「할 일」 폴더에 새 할 일을 만든다. 제목·날짜·중요도만 받는다 — 본문은 열어서 쓴다. 폴더가 없으면 서버가 만든다 */
  async function addTodo(title: string, date: string | null = null, dateEnd: string | null = null, priority: TodoPriority = 'medium'): Promise<Memo> {
    const memo = await $fetch<Memo>('/api/memos', {
      method: 'POST',
      body: { folder: TODO_FOLDER, title, content: '', date, dateEnd, done: false, priority },
    })
    await refresh()
    return memo
  }

  return { pending, find, setDone, setPriority, addTodo }
}
