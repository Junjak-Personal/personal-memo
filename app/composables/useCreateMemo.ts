import type { Memo } from '#shared/types/memo'

/** 빈 메모를 만들고 그 화면으로 간다. 사이드바와 빈 화면이 같이 쓴다 */
export function useCreateMemo() {
  const toast = useToast()
  const { refresh } = useMemoTree()
  const creating = ref(false)

  async function createMemo(folder = '') {
    if (creating.value) return
    creating.value = true
    try {
      const memo = await $fetch<Memo>('/api/memos', {
        method: 'POST',
        body: { folder, title: '', content: '', date: null, dateEnd: null },
      })
      await refresh()
      await navigateTo(memoPath(memo.id))
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '메모를 만들지 못했습니다') })
    } finally {
      creating.value = false
    }
  }

  return { creating, createMemo }
}
