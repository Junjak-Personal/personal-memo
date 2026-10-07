<script setup lang="ts">
/**
 * 휴지통 (설계문서 §3.4). 복원은 원래 위치로, 비우기는 되돌릴 수 없으니 확인을 받는다.
 * 비우면 이제 아무 메모도 쓰지 않는 이미지도 같이 지워진다. 30일이 지난 메모는 서버가 하루 한 번 지운다.
 */
import type { MemoMeta, TrashItem } from '#shared/types/memo'
import { daysUntilPurge, TRASH_RETENTION_DAYS } from '#shared/utils/trash'

const toast = useToast()
const { refresh: refreshTree } = useMemoTree()

const { data: items, error, refresh } = await useAsyncData('trash', () => $fetch<TrashItem[]>('/api/trash'))

const confirmOpen = ref(false)
const emptying = ref(false)
const restoring = ref<string | null>(null)

/** `2026-10-07T00:34:00+09:00` → `10월 7일 00:34` */
function formatTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

function purgeLabel(item: TrashItem) {
  const days = daysUntilPurge(item.trashedAt)
  return days === 0 ? '곧 자동 삭제' : `${days}일 뒤 자동 삭제`
}

async function restore(item: TrashItem) {
  restoring.value = item.path
  try {
    const restored = await $fetch<MemoMeta>('/api/trash/restore', { method: 'POST', body: { path: item.path } })
    await Promise.all([refresh(), refreshTree()])
    toast.add({
      color: 'success',
      title: `「${restored.title || '제목 없음'}」 을 복원했습니다`,
      actions: [{ label: '열기', color: 'neutral', variant: 'outline', onClick: () => void navigateTo(memoPath(restored.id)) }],
    })
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '복원하지 못했습니다') })
  } finally {
    restoring.value = null
  }
}

async function emptyTrash() {
  emptying.value = true
  try {
    const result = await $fetch<{ memos: number; images: number }>('/api/trash', { method: 'DELETE' })
    await refresh()
    confirmOpen.value = false
    toast.add({ title: `메모 ${result.memos}개와 쓰지 않는 이미지 ${result.images}개를 지웠습니다` })
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '휴지통을 비우지 못했습니다') })
  } finally {
    emptying.value = false
  }
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
    <Teleport to="#app-header-title" defer>휴지통</Teleport>
    <Teleport to="#app-header-actions" defer>
      <UButton
        color="error"
        variant="outline"
        icon="i-material-symbols-delete-forever-outline"
        :disabled="!items?.length"
        data-testid="trash-empty-button"
        @click="confirmOpen = true"
      >
        비우기
      </UButton>
    </Teleport>

    <p v-if="error" class="py-20 text-center text-error">{{ apiMessage(error, '휴지통을 불러오지 못했습니다') }}</p>
    <div v-else-if="!items?.length" class="flex flex-col items-center gap-3 py-20 text-center text-muted">
      <UIcon name="i-material-symbols-delete-outline" class="size-10 text-dimmed" />
      휴지통이 비었습니다
    </div>
    <template v-else>
      <p class="mx-auto w-full max-w-3xl text-sm text-muted">
        휴지통에 들어간 지 {{ TRASH_RETENTION_DAYS }}일이 지난 메모는 자동으로 지워집니다.
      </p>
      <ul class="mx-auto flex w-full max-w-3xl flex-col divide-y divide-default" data-testid="trash-list">
        <li v-for="item in items" :key="item.path" class="flex items-center gap-3 py-3">
          <UIcon name="i-material-symbols-description-outline" class="size-5 shrink-0 text-dimmed" />
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ item.title || '제목 없음' }}</p>
            <p class="truncate text-xs text-muted">
              {{ item.path }} · {{ formatTime(item.trashedAt) }} ·
              <span :data-testid="`trash-purge-days-${item.path}`">{{ purgeLabel(item) }}</span>
            </p>
          </div>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-material-symbols-restore-from-trash-outline"
            :loading="restoring === item.path"
            data-testid="trash-restore-button"
            @click="restore(item)"
          >
            복원
          </UButton>
        </li>
      </ul>
    </template>

    <!-- 페이지 최상위 요소를 하나로 둔다 — 화면 전환 애니메이션(pageTransition)의 조건 -->
    <UModal v-model:open="confirmOpen" title="휴지통을 비울까요?" description="지운 메모는 되돌릴 수 없습니다. 이제 어떤 메모도 쓰지 않는 이미지도 같이 지워집니다.">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="confirmOpen = false">취소</UButton>
          <UButton color="error" :loading="emptying" data-testid="trash-empty-confirm" @click="emptyTrash">비우기</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
