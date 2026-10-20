import type { FolderOrder, TreeResponse } from '#shared/types/memo'
import { EMPTY_ORDER } from '#shared/utils/order'
import { screenScope } from '~/utils/last-screen'
import { createSessionTree } from '~/utils/session-tree'

const appTrees = new WeakMap<object, ReturnType<typeof createSessionTree>>()

/**
 * 사이드바의 폴더·메모 트리. 화면 전체가 한 벌을 같이 쓴다.
 * 저장·이동·삭제처럼 트리가 바뀌는 동작 뒤에 refresh 를 부른다 — watch 로 따라가지 않는다.
 */
export function useMemoTree() {
  const nuxtApp = useNuxtApp()
  // middleware/plugin의 초기 ensure에서도 쓰므로 Vue inject가 가능한 앱 문맥을 준다.
  const toast = nuxtApp.vueApp.runWithContext(() => useToast())
  const { session } = useUserSession()

  const tree = useState<TreeResponse | null>('memo-tree', () => null)
  const error = useState<string | null>('memo-tree-error', () => null)
  const requests = useState('startup-tree-requests', () => 0)

  let shared = appTrees.get(nuxtApp)
  if (!shared) {
    shared = createSessionTree({
      scope: () => screenScope(session.value),
      tree: () => tree.value,
      setTree: (value) => { tree.value = value },
      setError: (value) => { error.value = value },
      fetch: () => {
        requests.value++
        return $fetch<TreeResponse>('/api/tree')
      },
      message: (e) => apiMessage(e, '목록을 불러오지 못했습니다'),
    })
    appTrees.set(nuxtApp, shared)
    const controller = shared
    // 인증 상태는 이 composable 밖에서도 바뀐다. 컴포넌트 수명과 무관하게 즉시 이전 목록을 지운다.
    const scope = effectScope(true)
    scope.run(() => watch(() => screenScope(session.value), () => controller.syncScope(), { flush: 'sync' }))
    nuxtApp.vueApp.onUnmount(() => scope.stop())
  }
  const { ensure, settled, refresh } = shared

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

  return { tree, error, ensure, settled, refresh, setFolderOrder, setTodoOrder }
}
