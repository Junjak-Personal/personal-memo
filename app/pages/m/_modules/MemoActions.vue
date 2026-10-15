<script setup lang="ts">
/**
 * 메모 메뉴 — 할 일로 두기/해제, 외부 공개, 폴더 이동, 휴지통으로.
 * 외부 공개 중이면 메뉴 옆에 「공개 중」 버튼을 늘 보여 준다 — 누르면 링크를 복사한다 (usePublicMemo).
 * 할 일로 두면 frontmatter 에 `done: false` 가 붙고 「할 일」 화면에 모인다. 해제하면 키를 지워 일반 메모로 (useTodo).
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
const todo = useTodo()
const share = usePublicMemo()

const moveOpen = ref(false)
const removing = ref(false)

/** 트리에 아직 없으면(방금 만든 메모) null — 일반 메모로 본다 */
const done = computed(() => todo.find(props.memoId())?.done ?? null)
const isPublic = computed(() => share.isPublic(props.memoId()))

const items = computed<DropdownMenuItem[][]>(() => [
  [
    done.value === null
      ? { label: '할 일로 두기', icon: 'i-material-symbols-add-task', onSelect: () => void todo.setDone(props.memoId(), false) }
      : { label: '할 일 해제', icon: 'i-material-symbols-remove-done', onSelect: () => void todo.setDone(props.memoId(), null) },
  ],
  isPublic.value
    ? [
        { label: '공개 링크 복사', icon: 'i-material-symbols-link', onSelect: () => void share.copyLink(props.memoId()) },
        { label: '외부 공개 끄기', icon: 'i-material-symbols-public-off', onSelect: () => void share.setPublic(props.memoId(), false) },
      ]
    : [{ label: '외부 공개', icon: 'i-material-symbols-public', onSelect: () => void share.setPublic(props.memoId(), true) }],
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
  <UTooltip v-if="isPublic" text="공개 링크 복사">
    <UButton
      icon="i-material-symbols-public"
      color="primary"
      variant="outline"
      size="sm"
      aria-label="외부 공개 중 — 공개 링크 복사"
      data-testid="memo-public-badge"
      @click="share.copyLink(props.memoId())"
    >
      <span class="hidden sm:inline">공개 중</span>
    </UButton>
  </UTooltip>

  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UTooltip text="메모 메뉴">
      <UButton icon="i-material-symbols-more-horiz" color="neutral" variant="ghost" aria-label="메모 메뉴" data-testid="memo-actions-button" />
    </UTooltip>
  </UDropdownMenu>

  <FolderPickDialog v-model:open="moveOpen" title="폴더 이동" :current="folder" @pick="move" />
</template>
