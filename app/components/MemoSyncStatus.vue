<script setup lang="ts">
const sync = useMemoSync()
const { loggedIn } = useUserSession()
const open = ref(false)
const running = computed(() => sync.state.value.status === 'refreshing')
const warning = computed(() => !sync.online.value || sync.pendingDrafts.value > 0 || sync.state.value.status === 'error')
const lastUpdated = computed(() => sync.state.value.refreshedAt ? new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(sync.state.value.refreshedAt)) : '아직 갱신하지 않음')
async function refresh() { await sync.refresh(true); sync.updateDrafts() }
</script>

<template>
  <UPopover v-if="loggedIn" v-model:open="open" :content="{ align: 'end' }">
    <UTooltip text="연결·새로고침">
      <UButton :icon="sync.online.value ? 'i-material-symbols-sync' : 'i-material-symbols-cloud-off-outline'" :color="warning ? 'warning' : 'neutral'" variant="outline" class="size-11 shrink-0 justify-center lg:size-8" :loading="running" aria-label="연결 상태와 새로고침" data-testid="memo-sync-open" @click="sync.updateDrafts()" />
    </UTooltip>
    <template #content>
      <div class="w-72 max-w-[calc(100vw-2rem)] space-y-3 p-3 text-sm" data-testid="memo-sync-panel">
        <p class="font-medium">{{ sync.online.value ? '온라인' : '오프라인' }}</p>
        <p class="text-xs text-muted">마지막 화면 갱신: {{ lastUpdated }}</p>
        <p v-if="sync.pendingDrafts.value" class="text-warning" data-testid="memo-sync-pending">이 기기에 보관 중인 수정 {{ sync.pendingDrafts.value }}개</p>
        <p v-if="sync.conflicts.value" class="text-warning">충돌 {{ sync.conflicts.value }}개는 해당 메모에서 확인해 주세요.</p>
        <p v-if="sync.state.value.status === 'error'" role="alert" class="text-error" data-testid="memo-sync-error">{{ sync.state.value.message }}</p>
        <div v-if="sync.pendingItems.value.length" class="max-h-48 space-y-2 overflow-y-auto" data-testid="memo-sync-drafts">
          <UButton v-for="(draft, index) in sync.pendingItems.value" :key="draft.id" :to="memoPath(draft.id)" color="neutral" variant="outline" class="w-full justify-start text-left" :data-testid="`memo-sync-draft-open-${index}`" @click="open = false">
            <span class="min-w-0">
              <span class="block truncate">{{ draft.title || '제목 없음' }}</span>
              <span class="block text-xs text-muted">{{ draft.conflict ? '충돌 확인 필요' : draft.source ? '원문 편집에서 저장 필요' : draft.review ? '메모를 열어 형식 확인 필요' : '저장 재시도 대기' }}</span>
            </span>
          </UButton>
        </div>
        <p v-if="!sync.online.value" class="text-muted">현재 화면을 유지합니다. 연결이 돌아오면 저장을 재시도합니다. 원문·형식·충돌 확인이 필요한 수정은 메모를 열어 확인해 주세요.</p>
        <div class="flex justify-end">
          <UButton icon="i-material-symbols-refresh" :loading="running" :disabled="!sync.online.value" data-testid="memo-sync-refresh" @click="refresh">현재 화면 새로고침</UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
