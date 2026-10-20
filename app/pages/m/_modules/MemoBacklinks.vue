<script setup lang="ts">
import { useMemoBacklinks } from './useMemoBacklinks'

const props = defineProps<{ memoId: string }>()
const { rows, error, loading, refresh } = useMemoBacklinks(() => props.memoId)
</script>

<template>
  <section class="mx-auto w-full max-w-4xl px-4 pb-12 sm:px-14" aria-label="이 메모를 참조하는 메모" data-testid="memo-backlinks">
    <div class="mb-2 flex items-center justify-between gap-2 border-t border-default pt-4">
      <h2 class="text-sm font-medium text-muted">이 메모를 참조하는 메모 <span v-if="rows.length">{{ rows.length }}</span></h2>
      <UButton color="neutral" variant="ghost" icon="i-material-symbols-refresh" size="sm" :loading="loading" aria-label="참조 목록 새로고침" @click="refresh" />
    </div>
    <UAlert v-if="error" :title="error" color="error" variant="subtle" :actions="[{ label: '다시 시도', color: 'neutral', variant: 'outline', onClick: refresh }]" />
    <div v-else-if="rows.length" class="flex flex-col gap-1">
      <NuxtLink v-for="row in rows" :key="row.id" :to="memoPath(row.id)" class="rounded-md border border-default px-3 py-2 hover:bg-elevated" data-testid="memo-backlink">
        <span class="block truncate text-sm">{{ row.title || '제목 없음' }}</span>
        <span class="block truncate text-xs text-muted">{{ row.folder || '최상위' }}</span>
      </NuxtLink>
    </div>
    <p v-else role="status" class="text-sm text-dimmed">{{ loading ? '참조 목록을 불러오는 중…' : '아직 이 메모를 참조하는 메모가 없습니다' }}</p>
  </section>
</template>
