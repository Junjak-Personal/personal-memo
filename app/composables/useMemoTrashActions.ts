import type { MemoMeta } from '#shared/types/memo'

/** 사이드바·메모 메뉴가 공유하는 휴지통 이동과 되돌리기. 저장/이동 전제조건은 호출 화면이 판단한다. */
export function useMemoTrashActions() {
  const toast = useToast()
  const { refresh } = useMemoTree()

  async function moveToTrash(id: string): Promise<string> {
    // 같은 이름이 있으면 (2)가 붙는다. 되돌릴 때는 원래 메모 경로가 아니라 서버의 실제 경로를 쓴다.
    const { trashPath } = await $fetch<{ trashPath: string }>(`/api/memos/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await refresh()
    return trashPath
  }

  /** 사이드바를 먼저 닫은 뒤 알리는 기존 순서를 유지할 수 있게 이동과 알림을 나눈다. */
  function notifyMoved(trashPath: string) {
    toast.add({
      title: '휴지통으로 옮겼습니다',
      actions: [{ label: '되돌리기', color: 'neutral', variant: 'outline', onClick: () => void restore(trashPath) }],
    })
  }

  async function restore(trashPath: string) {
    try {
      const restored = await $fetch<MemoMeta>('/api/trash/restore', { method: 'POST', body: { path: trashPath } })
      await refresh()
      await navigateTo(memoPath(restored.id))
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '되돌리지 못했습니다'), description: '휴지통 화면에서 복원하세요.' })
    }
  }

  return { moveToTrash, notifyMoved }
}
