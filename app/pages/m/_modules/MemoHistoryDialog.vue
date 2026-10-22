<script setup lang="ts">
import { useMemoHistory } from './useMemoHistory'

const props = defineProps<{
  memoId: () => string
  version: () => string
  flush: () => Promise<boolean>
}>()

const toast = useToast()
const active = useActiveMemo()
const { refresh } = useMemoTree()
const history = useMemoHistory({
  memoId: props.memoId,
  version: props.version,
  flush: props.flush,
  onRestored: (memo) => {
    if (active.isOpen(memo.id)) active.reload()
    void refresh()
    toast.add({ title: '선택한 버전으로 복원했습니다', description: '복원 직전 내용도 수정 이력에 보관했습니다.' })
  },
})
const { open, loading, selecting, restoring, confirming, error, conflict, revisions, selected, selectedReady } = history
const dateTime = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' })
function label(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date)
}
function onOpen(value: boolean) {
  if (!value && !restoring.value) history.close()
}
function reloadCurrent() {
  history.close()
  if (active.isOpen(props.memoId())) active.reload()
}
defineExpose({ show: history.show })
</script>

<template>
  <UModal
    :open="open"
    title="수정 이력"
    description="이전 내용을 확인하고 선택한 버전으로 복원합니다."
    :dismissible="!restoring"
    :close="!restoring"
    :ui="{ content: 'sm:max-w-4xl', body: 'min-h-0' }"
    @update:open="onOpen"
  >
    <template #body>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        :title="error"
        :actions="[{ label: conflict ? '현재 메모 다시 불러오기' : '다시 불러오기', color: 'neutral', variant: 'outline', onClick: conflict ? reloadCurrent : history.show }]"
        class="mb-4"
        data-testid="memo-history-error"
      />
      <MemoLoadingRegion :loading="loading && !selecting" label="수정 이력을 불러오는 중…">
        <div v-if="revisions.length" class="grid min-h-0 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <nav aria-label="저장된 버전" class="flex max-h-36 flex-col gap-1 overflow-y-auto sm:max-h-[50dvh]">
            <button
              v-for="revision in revisions"
              :key="revision.id"
              type="button"
              class="rounded-md border border-default px-3 py-2 text-left text-sm hover:bg-elevated"
              :class="selected?.id === revision.id && 'bg-elevated ring-1 ring-primary'"
              :aria-pressed="selected?.id === revision.id"
              :disabled="restoring"
              data-testid="memo-history-revision"
              @click="history.select(revision.id)"
            >
              <span class="block">{{ label(revision.savedAt) }}</span>
              <span class="block truncate text-xs text-muted">{{ revision.title || '제목 없음' }}</span>
            </button>
          </nav>
          <MemoLoadingRegion :loading="selecting" label="버전을 불러오는 중…" class="min-w-0">
            <article v-if="selected" class="max-h-[45dvh] overflow-auto rounded-md border border-default p-4 sm:max-h-[50dvh]" data-testid="memo-history-preview">
              <h3 class="mb-2 text-lg font-semibold break-words">{{ selected.title || '제목 없음' }}</h3>
              <p v-if="selected.date" class="mb-2 text-xs text-muted">{{ selected.date }}{{ selected.dateEnd ? ` ~ ${selected.dateEnd}` : '' }}</p>
              <p v-if="selected.tags.length" class="mb-3 text-xs text-muted">{{ selected.tags.map(tag => `#${tag}`).join(' ') }}</p>
              <p class="mb-2 text-xs text-dimmed">본문 원문</p>
              <pre class="font-sans text-sm whitespace-pre-wrap break-words">{{ selected.content || '(빈 메모)' }}</pre>
            </article>
          </MemoLoadingRegion>
        </div>
        <p v-else-if="!loading && !error" class="py-8 text-center text-sm text-muted" data-testid="memo-history-empty">아직 수정 이력이 없습니다. 내용을 수정해 저장하면 이전 버전이 여기에 보관됩니다.</p>
      </MemoLoadingRegion>
      <UAlert
        v-if="confirming"
        color="warning"
        variant="subtle"
        title="이 버전으로 복원할까요?"
        description="제목·본문·날짜·태그가 바뀝니다. 현재 내용은 이력에 보관되며, 폴더·완료·공개 상태는 유지됩니다."
        class="mt-4"
      />
      <p class="mt-4 text-xs text-dimmed">연속 수정은 5분 단위로 묶고, 최근 30일 안의 최대 50개 버전을 보관합니다.</p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" :disabled="restoring" @click="confirming ? confirming = false : history.close()">{{ confirming ? '취소' : '닫기' }}</UButton>
        <UButton v-if="confirming" :loading="restoring" :disabled="!selectedReady || selecting || loading" data-testid="memo-history-confirm" @click="history.restore">이 버전으로 복원</UButton>
        <UButton v-else :disabled="!selectedReady || selecting || loading" data-testid="memo-history-restore" @click="confirming = true">이 버전으로 복원…</UButton>
      </div>
    </template>
  </UModal>
</template>
