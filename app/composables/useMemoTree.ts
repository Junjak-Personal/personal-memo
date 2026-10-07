import type { TreeResponse } from '#shared/types/memo'

/**
 * 사이드바의 폴더·메모 트리. 화면 전체가 한 벌을 같이 쓴다.
 * 저장·이동·삭제처럼 트리가 바뀌는 동작 뒤에 refresh 를 부른다 — watch 로 따라가지 않는다.
 */
export function useMemoTree() {
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

  return { tree, error, refresh }
}
