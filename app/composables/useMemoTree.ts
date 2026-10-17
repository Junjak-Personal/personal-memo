import type { FolderOrder, TreeResponse } from '#shared/types/memo'
import { EMPTY_ORDER } from '#shared/utils/order'

/**
 * 사이드바의 폴더·메모 트리. 화면 전체가 한 벌을 같이 쓴다.
 * 저장·이동·삭제처럼 트리가 바뀌는 동작 뒤에 refresh 를 부른다 — watch 로 따라가지 않는다.
 */
export function useMemoTree() {
  const toast = useToast()

  const tree = useState<TreeResponse | null>('memo-tree', () => null)
  const error = useState<string | null>('memo-tree-error', () => null)

  async function refresh() {
    try {
      tree.value = await $fetch<TreeResponse>('/api/tree')
      error.value = null
    } catch (e) {
      error.value = apiMessage(e, '목록을 불러오지 못했습니다')
    }
  }

  /**
   * 폴더 안의 순서 (설계문서 §3.6). 화면에 바로 반영하고 저장한다 — 끌어 놓은 줄이 제자리로 튀었다 오지 않게.
   * 저장하지 못하면 알리고 서버의 순서로 되돌린다.
   */
  async function setFolderOrder(folder: string, patch: Partial<FolderOrder>) {
    if (tree.value) {
      const current = tree.value.orders[folder] ?? EMPTY_ORDER
      tree.value = { ...tree.value, orders: { ...tree.value.orders, [folder]: { ...current, ...patch } } }
    }
    try {
      await $fetch('/api/folders/order', { method: 'PUT', body: { folder, ...patch } })
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '순서를 저장하지 못했습니다') })
      await refresh()
    }
  }

  /** 「할 일」 화면의 순서 */
  async function setTodoOrder(ids: string[]) {
    if (tree.value) tree.value = { ...tree.value, todoOrder: ids }
    try {
      await $fetch('/api/todos/order', { method: 'PUT', body: { ids } })
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '순서를 저장하지 못했습니다') })
      await refresh()
    }
  }

  return { tree, error, refresh, setFolderOrder, setTodoOrder }
}
