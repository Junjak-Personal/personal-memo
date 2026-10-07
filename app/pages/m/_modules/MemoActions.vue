<script setup lang="ts">
/**
 * 메모 메뉴 — 폴더 이동, 휴지통으로.
 * 폴더 이동은 대기열에 넣는다 — 사이드바엔 바로 보이고 파일은 3초 뒤 옮겨진다 (useStructureQueue).
 * 휴지통은 바로 한다 — 고친 게 남아 있으면 먼저 저장한다.
 * 삭제는 휴지통으로 옮기는 것이라 확인창 대신 「되돌리기」 알림을 준다.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MemoMeta } from '#shared/types/memo'

const props = defineProps<{
  memoId: () => string
  title: () => string
  folder: string
}>()

const toast = useToast()
const { refresh } = useMemoTree()
const activeMemo = useActiveMemo()
const queue = useStructureQueue()

const moveOpen = ref(false)
const removing = ref(false)

const items = computed<DropdownMenuItem[][]>(() => [
  [{ label: '폴더 이동', icon: 'i-material-symbols-drive-file-move-outline', onSelect: () => (moveOpen.value = true) }],
  [{ label: '휴지통으로', icon: 'i-material-symbols-delete-outline', color: 'error', onSelect: remove }],
])

function move(folder: string) {
  queue.push({ kind: 'moveMemo', id: props.memoId(), title: props.title(), folder })
  moveOpen.value = false
}

async function remove() {
  if (removing.value) return
  // 대기 중인 옮기기를 먼저 반영한다 — 이 메모를 옮기는 변경이 남은 채 지우면 그 변경이 실패한다
  if (!(await queue.apply())) return
  if (!(await activeMemo.flush())) {
    toast.add({ color: 'error', title: '저장하지 못해서 지우지 않았습니다', description: '저장 상태를 먼저 확인하세요.' })
    return
  }
  removing.value = true
  try {
    // 휴지통 안의 실제 경로 — 같은 이름이 이미 있으면 (2) 가 붙어 원래 경로와 다르다
    const { trashPath } = await $fetch<{ trashPath: string }>(`/api/memos/${encodeURIComponent(props.memoId())}`, { method: 'DELETE' })
    await refresh()
    toast.add({
      title: '휴지통으로 옮겼습니다',
      actions: [{ label: '되돌리기', color: 'neutral', variant: 'outline', onClick: () => void restore(trashPath) }],
    })
    await navigateTo('/')
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '지우지 못했습니다') })
  } finally {
    removing.value = false
  }
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
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UTooltip text="메모 메뉴">
      <UButton icon="i-material-symbols-more-horiz" color="neutral" variant="ghost" aria-label="메모 메뉴" data-testid="memo-actions-button" />
    </UTooltip>
  </UDropdownMenu>

  <FolderPickDialog v-model:open="moveOpen" title="폴더 이동" :current="folder" @pick="move" />
</template>
