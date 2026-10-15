<script setup lang="ts">
import type { MemoMeta } from '#shared/types/memo'
import { isDateString, kstDay } from '#shared/utils/memo-date'
import { cleanTag, cleanTags, hasTag } from '#shared/utils/tags'

const route = useRoute()
const { tree, error, refresh } = useMemoTree()

const refreshing = ref(false)
const selectedTag = computed(() => (typeof route.query.tag === 'string' ? cleanTag(route.query.tag) : null))
const loading = computed(() => refreshing.value || (!tree.value && !error.value))
/** hasTag 와 같은 대소문자 규칙으로 묶고, 한 메모에 같은 태그가 여러 번 있어도 한 번만 센다. */
const tagCounts = computed(() => {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const memo of tree.value?.memos ?? []) {
    const seen = new Set<string>()
    for (const tag of cleanTags(memo.tags)) {
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { tag, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ko'))
})
const selectedLabel = computed(() => tagCounts.value.find((entry) => selectedTag.value && hasTag([entry.tag], selectedTag.value))?.tag ?? selectedTag.value)
const taggedMemos = computed(() => (tree.value?.memos ?? []).filter((memo) => cleanTags(memo.tags).length > 0))
const items = computed(() => {
  const selected = selectedTag.value
  return taggedMemos.value
    .filter((memo) => !selected || hasTag(cleanTags(memo.tags), selected))
    .sort((a, b) => (b.updated ?? b.created ?? '').localeCompare(a.updated ?? a.created ?? '') || a.title.localeCompare(b.title, 'ko'))
})

onMounted(() => {
  if (!tree.value) void reload()
})

function isSelected(tag: string) {
  return selectedTag.value !== null && hasTag([tag], selectedTag.value)
}

function dateLabel(memo: MemoMeta) {
  if (memo.date && isDateString(memo.date)) {
    return memo.dateEnd && isDateString(memo.dateEnd) ? `${formatDay(memo.date)} ~ ${formatDay(memo.dateEnd)}` : formatDay(memo.date)
  }
  const updatedDay = memo.updated ? kstDay(memo.updated) : null
  if (updatedDay && isDateString(updatedDay)) return `수정 ${formatDay(updatedDay)}`
  const createdDay = memo.created ? kstDay(memo.created) : null
  if (createdDay && isDateString(createdDay)) return `작성 ${formatDay(createdDay)}`
  return null
}

async function reload() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await refresh()
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col p-4 sm:p-6" data-testid="tags-page">
    <Teleport to="#app-header-title" defer>태그</Teleport>
    <Teleport to="#app-header-actions" defer>
      <UTooltip text="목록 새로고침">
        <UButton
          icon="i-material-symbols-refresh"
          color="neutral"
          variant="ghost"
          class="size-11 justify-center"
          :loading="refreshing"
          aria-label="목록 새로고침"
          data-testid="tags-list-refresh"
          @click="reload"
        />
      </UTooltip>
    </Teleport>

    <div class="mx-auto w-full max-w-5xl" :aria-busy="loading">
      <div v-if="loading" class="flex flex-col gap-4" role="status" data-testid="tags-list-loading">
        <span class="sr-only">태그와 메모를 불러오는 중입니다</span>
        <div class="flex flex-wrap gap-2">
          <USkeleton v-for="index in 4" :key="index" class="h-11 w-24" />
        </div>
        <USkeleton v-for="index in 3" :key="index" class="h-16 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-material-symbols-error-outline"
        :title="error"
        data-testid="tags-list-error"
      >
        <template #actions>
          <UButton color="neutral" variant="outline" class="min-h-11" data-testid="tags-list-retry" @click="reload">
            다시 불러오기
          </UButton>
        </template>
      </UAlert>

      <div v-else-if="!tagCounts.length && !selectedTag" class="flex flex-col items-center gap-3 py-20 text-center" data-testid="tags-list-empty">
        <UIcon name="i-material-symbols-label-outline" class="size-10 text-dimmed" />
        <p class="font-medium text-highlighted">아직 태그가 없습니다</p>
        <p class="text-sm text-muted">메모에 태그를 붙이면 여기에서 모아 볼 수 있습니다</p>
      </div>

      <div v-else class="flex min-w-0 flex-col gap-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8">
        <aside class="min-w-0">
          <h2 class="mb-3 flex items-center gap-2 text-sm font-semibold text-highlighted">
            전체 태그
            <span class="text-xs font-normal text-muted">{{ tagCounts.length }}개</span>
          </h2>
          <nav aria-label="메모 태그" class="flex flex-wrap gap-2 lg:flex-col" data-testid="tags-filter-list">
            <NuxtLink
              to="/tags"
              class="flex min-h-11 min-w-0 max-w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors"
              :class="!selectedTag ? 'border-primary/40 bg-primary/10 text-primary' : 'border-default bg-default text-default hover:bg-elevated'"
              :aria-current="!selectedTag ? 'true' : undefined"
              data-testid="tags-filter-all"
            >
              <span>전체</span>
              <span class="shrink-0 text-xs tabular-nums">{{ taggedMemos.length }}</span>
            </NuxtLink>
            <NuxtLink
              v-for="(entry, index) in tagCounts"
              :key="entry.tag.toLowerCase()"
              :to="{ path: '/tags', query: { tag: entry.tag } }"
              class="flex min-h-11 min-w-0 max-w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors"
              :class="isSelected(entry.tag) ? 'border-primary/40 bg-primary/10 text-primary' : 'border-default bg-default text-default hover:bg-elevated'"
              :aria-current="isSelected(entry.tag) ? 'true' : undefined"
              :aria-label="`${entry.tag} 태그 메모 ${entry.count}개`"
              :data-testid="`tags-filter-select-${index}`"
            >
              <span class="truncate">#{{ entry.tag }}</span>
              <span class="shrink-0 text-xs tabular-nums">{{ entry.count }}</span>
            </NuxtLink>
          </nav>
        </aside>

        <section class="min-w-0" aria-labelledby="tags-memos-title">
          <h2 id="tags-memos-title" class="mb-3 flex min-w-0 items-center gap-2 text-sm font-semibold text-highlighted">
            <span class="truncate">{{ selectedLabel ? `#${selectedLabel}` : '태그가 있는 메모' }}</span>
            <span class="shrink-0 text-xs font-normal text-muted" data-testid="tags-memos-count">{{ items.length }}개</span>
          </h2>
          <div v-if="!items.length" class="flex flex-col items-start gap-3 py-10" data-testid="tags-memos-empty">
            <p class="text-sm text-muted">「{{ selectedLabel }}」 태그가 붙은 메모가 없습니다</p>
            <UButton to="/tags" color="neutral" variant="outline" class="min-h-11" data-testid="tags-filter-reset">전체 태그 보기</UButton>
          </div>
          <ul v-else class="flex flex-col divide-y divide-default" data-testid="tags-memo-list">
            <li v-for="(memo, index) in items" :key="memo.id">
              <NuxtLink
                :to="memoPath(memo.id)"
                class="flex min-h-11 min-w-0 items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-elevated"
                :data-testid="`tags-memo-open-${index}`"
              >
                <UIcon name="i-material-symbols-description-outline" class="size-5 shrink-0 text-dimmed" />
                <div class="min-w-0 flex-1">
                  <p class="truncate font-medium text-highlighted">{{ memo.title || '제목 없음' }}</p>
                  <p class="mt-1 truncate text-xs text-muted">
                    {{ memo.folder || '최상위' }}
                    <span v-if="dateLabel(memo)"> · {{ dateLabel(memo) }}</span>
                  </p>
                </div>
                <UIcon name="i-material-symbols-chevron-right" class="size-5 shrink-0 text-dimmed" />
              </NuxtLink>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>
