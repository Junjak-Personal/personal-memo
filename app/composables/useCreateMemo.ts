import type { DropdownMenuItem } from '@nuxt/ui'
import type { Memo } from '#shared/types/memo'

/** 사이드바와 빈 화면이 생성 선택 메뉴와 빈 메모 생성을 공유한다. */
export function useCreateMemo() {
  const toast = useToast()
  const { refresh } = useMemoTree()
  const queue = useStructureQueue()
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

  function creationItems(folder: string, showTemplates: (folder: string) => Promise<void>) {
    return [
      {
        label: '새 메모로 생성', icon: 'i-material-symbols-note-add-outline', disabled: creating.value, testId: 'memo-create-blank',
        onSelect: () => void createInFolder(folder),
      },
      {
        label: '템플릿에서 생성', icon: 'i-material-symbols-note-stack-outline', disabled: creating.value, testId: 'memo-create-template',
        onSelect: () => void showTemplates(folder),
      },
    ] satisfies DropdownMenuItem[]
  }

  async function createInFolder(folder: string) {
    if (await queue.apply()) await createMemo(folder)
  }

  return { creating, createMemo, creationItems }
}
