<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'
import type { PublicFolderNode, PublicMemoSummary, PublicTreeResponse } from '#shared/types/memo'

const route = useRoute()
const mobileOpen = ref(false)
const { data: tree, status, error, refresh } = useAsyncData(
  () => `ext-navigation:${route.path}`,
  () => $fetch<PublicTreeResponse>('/api/ext/tree'),
  { getCachedData: () => undefined },
)

function memoItems(memos: PublicMemoSummary[]): TreeItem[] {
  return memos.map(memo => ({
    value: `memo:${memo.id}`,
    label: memo.title || '제목 없음',
    icon: 'i-material-symbols-description-outline',
    url: `/ext/${encodeURIComponent(memo.id)}`,
    testId: `ext-memo-open-${memo.id}`,
  }))
}

function folderItems(folders: PublicFolderNode[]): TreeItem[] {
  return folders.map(folder => ({
    value: `folder:${folder.id}`,
    label: folder.name,
    icon: 'i-material-symbols-folder-outline',
    url: `/ext/folder/${encodeURIComponent(folder.id)}`,
    testId: `ext-folder-open-${folder.id}`,
    toggleTestId: `ext-folder-toggle-${folder.id}`,
    defaultExpanded: true,
    children: [...folderItems(folder.children), ...memoItems(folder.memos)],
  }))
}

const items = computed(() => tree.value ? [...folderItems(tree.value.folders), ...memoItems(tree.value.memos)] : [])
</script>

<template>
  <div class="min-h-dvh bg-default lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
    <header class="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-default bg-default px-4 lg:hidden">
      <UButton icon="i-material-symbols-menu" color="neutral" variant="outline" aria-label="공개 목록 열기" :aria-expanded="mobileOpen" data-testid="ext-navigation-open" @click="mobileOpen = true" />
      <span class="text-sm font-medium">공개 메모</span>
    </header>

    <button v-if="mobileOpen" type="button" class="fixed inset-0 z-30 bg-inverted/30 lg:hidden" aria-label="공개 목록 닫기" data-testid="ext-navigation-backdrop" @click="mobileOpen = false" />
    <aside
      class="z-40 flex h-dvh w-72 flex-col border-e border-default bg-default lg:sticky lg:top-0"
      :class="mobileOpen ? 'fixed inset-y-0 start-0' : 'hidden lg:flex'"
      aria-label="공개 폴더와 메모"
      data-testid="ext-navigation"
    >
      <div class="flex h-16 shrink-0 items-center gap-2 border-b border-default px-4">
        <UIcon name="i-material-symbols-public" class="size-5 text-primary" />
        <span class="flex-1 font-semibold">공개 메모</span>
        <UButton icon="i-material-symbols-close" color="neutral" variant="ghost" class="lg:hidden" aria-label="공개 목록 닫기" data-testid="ext-navigation-close" @click="mobileOpen = false" />
      </div>
      <nav class="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="공개 항목 탐색" :aria-busy="status === 'pending'">
        <div v-if="status === 'pending'" class="space-y-3 px-2" role="status" aria-label="공개 목록을 불러오는 중">
          <USkeleton v-for="index in 4" :key="index" class="h-7 w-full" />
        </div>
        <div v-else-if="error" class="space-y-3" data-testid="ext-navigation-error">
          <UAlert title="공개 목록을 불러오지 못했습니다" color="error" variant="subtle" />
          <UButton color="neutral" variant="outline" data-testid="ext-navigation-retry" @click="refresh()">다시 시도</UButton>
        </div>
        <UTree v-else-if="items.length" :items="items" :get-key="(item: TreeItem) => String(item.value)" :as="{ link: 'div' }">
          <template #item="{ item, handleToggle, expanded }">
            <div class="flex min-h-10 min-w-0 flex-1 items-center gap-1">
              <NuxtLink
                :to="String(item.url)"
                class="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent px-2 py-2 text-sm hover:bg-elevated"
                :class="route.path === item.url && 'border-primary/20 bg-primary/10 text-primary'"
                :aria-current="route.path === item.url ? 'page' : undefined"
                :data-testid="String(item.testId)"
                @click.stop="mobileOpen = false"
              >
                <UIcon :name="String(item.icon)" class="size-4 shrink-0" />
                <span class="truncate">{{ item.label }}</span>
              </NuxtLink>
              <UButton
                v-if="item.children?.length"
                :icon="expanded ? 'i-material-symbols-keyboard-arrow-up' : 'i-material-symbols-keyboard-arrow-down'"
                color="neutral"
                variant="ghost"
                :aria-label="`${item.label} ${expanded ? '접기' : '펼치기'}`"
                :aria-expanded="expanded"
                :data-testid="String(item.toggleTestId)"
                @click.stop="handleToggle"
              />
            </div>
          </template>
        </UTree>
        <p v-else class="px-2 py-4 text-sm text-muted" data-testid="ext-navigation-empty">공개된 폴더와 메모가 없습니다.</p>
      </nav>
      <p class="border-t border-default px-4 py-3 text-xs text-dimmed">공개된 항목만 표시됩니다.</p>
    </aside>

    <div class="min-w-0"><slot /></div>
  </div>
</template>
