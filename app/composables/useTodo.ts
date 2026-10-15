import type { Memo, MemoMeta } from '#shared/types/memo'
import { TODO_FOLDER } from '#shared/utils/todo'

/**
 * 할 일 (설계문서 §3.5) — 체크, 할 일로 두기/풀기, 새 할 일. 사이드바·「할 일」 화면·메모 화면이 같이 쓴다.
 *
 * 상태의 원본은 사이드바 트리(useMemoTree) 하나다. 체크하면 트리의 그 메모를 먼저 바꾸고(바로 보이게) 서버가 거절하면
 * 되돌린다. 열린 편집기와 따로 맞출 것은 없다 — 서버가 버전을 done 줄을 빼고 재서 편집기의 다음 저장이 막히지 않는다.
 */
export function useTodo() {
  const toast = useToast()
  const { tree, refresh } = useMemoTree()
  const calendarSync = useCalendarSyncStatus()
  /** 서버에 보내는 중인 메모 — 응답이 오기 전에 또 누르면 순서가 뒤섞이므로 그동안은 막는다 */
  const pending = useState<string[]>('todo-pending', () => [])

  function find(id: string) {
    return tree.value?.memos.find((m) => m.id === id) ?? null
  }

  function patchTree(id: string, done: boolean | null) {
    const memos = tree.value?.memos
    const index = memos?.findIndex((m) => m.id === id) ?? -1
    if (memos && index !== -1) memos[index] = { ...memos[index]!, done }
  }

  /** done: true = 끝냄, false = 할 일(안 끝남), null = 할 일 해제 */
  async function setDone(id: string, done: boolean | null) {
    if (pending.value.includes(id)) return false
    const before = find(id)
    pending.value = [...pending.value, id]
    patchTree(id, done)
    try {
      const meta = await $fetch<MemoMeta>(`/api/memos/${encodeURIComponent(id)}/done`, { method: 'PATCH', body: { done } })
      patchTree(id, meta.done)
      // 날짜 있는 할 일이면 구글 일정이 지워지거나 다시 생긴다 — 반영 실패 표시를 잠시 뒤 다시 본다
      if (meta.date) calendarSync.recheckSoon()
      return true
    } catch (e) {
      patchTree(id, before?.done ?? null)
      toast.add({ color: 'error', title: apiMessage(e, '할 일을 바꾸지 못했습니다') })
      return false
    } finally {
      pending.value = pending.value.filter((p) => p !== id)
    }
  }

  /** 「할 일」 폴더에 새 할 일을 만든다. 제목과 날짜만 받는다 — 본문은 열어서 쓴다 */
  async function addTodo(title: string, date: string | null = null, dateEnd: string | null = null): Promise<Memo> {
    // 폴더가 이미 보이면 만들지 않는다 — 매번 보내면 409 가 콘솔에 쌓인다
    if (!tree.value?.folders.some((f) => f.path === TODO_FOLDER)) await ensureFolder(TODO_FOLDER)
    const memo = await $fetch<Memo>('/api/memos', {
      method: 'POST',
      body: { folder: TODO_FOLDER, title, content: '', date, dateEnd, done: false },
    })
    await refresh()
    return memo
  }

  return { pending, find, setDone, addTodo }
}
