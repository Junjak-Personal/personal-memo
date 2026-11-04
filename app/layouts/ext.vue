<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'
import type { PublicFolderNode, PublicMemoSummary, PublicTreeResponse } from '#shared/types/memo'

const route = useRoute()
const year = new Date().getFullYear()
const expanded = ref<string[]>([])
const searchInput = ref('')
const selectedSearchMemo = ref<PublicMemoSummary | null>(null)
const { data: tree, status, error, refresh } = useAsyncData(
  'ext-navigation',
  () => $fetch<PublicTreeResponse>('/api/ext/tree'),
  { getCachedData: () => undefined },
)

const items = computed(() => tree.value ? [...folderItems(tree.value.folders), ...memoItems(tree.value.memos)] : [])
const selected = computed(() => findItem(items.value, route.path))
const searchItems = computed(() => tree.value
  ? [...tree.value.memos, ...folderMemos(tree.value.folders)]
    .map(memo => ({ ...memo, title: memo.title || '제목 없음' }))
    .sort((a, b) => a.title.localeCompare(b.title, 'ko'))
  : [])

// 직접 진입·연결 메모·뒤로가기도 현재 위치의 조상만 펼친다. 사용자의 다른 펼침 상태는 유지한다.
watch([items, () => route.path], ([nodes, path]) => {
  expanded.value = [...new Set([...expanded.value, ...ancestorKeys(nodes, path)])]
}, { immediate: true })

useHead({ titleTemplate: title => title ? `${title} · Jun's Memo` : "Jun's Memo" })

function openItem(url: string) {
  return navigateTo(url)
}

async function selectSearchMemo(memo: PublicMemoSummary | null) {
  if (!memo) return
  await openItem(`/ext/${encodeURIComponent(memo.id)}`)
  selectedSearchMemo.value = null
  searchInput.value = ''
}

function folderMemos(folders: PublicFolderNode[]): PublicMemoSummary[] {
  return folders.flatMap(folder => [...folder.memos, ...folderMemos(folder.children)])
}

function memoItems(memos: PublicMemoSummary[]): TreeItem[] {
  return memos.map(memo => ({
    value: `memo:${memo.id}`,
    kind: 'memo',
    label: memo.title || '제목 없음',
    icon: 'i-material-symbols-description-outline',
    url: `/ext/${encodeURIComponent(memo.id)}`,
    testId: `ext-memo-open-${memo.id}`,
    onSelect: () => openItem(`/ext/${encodeURIComponent(memo.id)}`),
  }))
}

function folderItems(folders: PublicFolderNode[]): TreeItem[] {
  return folders.map(folder => ({
    value: `folder:${folder.id}`,
    kind: 'folder',
    label: folder.name,
    icon: 'i-material-symbols-folder-outline',
    url: `/ext/folder/${encodeURIComponent(folder.id)}`,
    testId: `ext-folder-open-${folder.id}`,
    toggleTestId: `ext-folder-toggle-${folder.id}`,
    children: [...folderItems(folder.children), ...memoItems(folder.memos)],
    onSelect: () => openItem(`/ext/folder/${encodeURIComponent(folder.id)}`),
  }))
}

function findItem(nodes: TreeItem[], path: string): TreeItem | undefined {
  for (const item of nodes) {
    if (item.url === path) return item
    const child = item.children && findItem(item.children, path)
    if (child) return child
  }
}

function ancestorKeys(nodes: TreeItem[], path: string): string[] {
  for (const item of nodes) {
    if (item.url === path) return item.kind === 'folder' ? [String(item.value)] : []
    if (item.children && findItem(item.children, path)) return [String(item.value), ...ancestorKeys(item.children, path)]
  }
  return []
}
</script>

<template>
  <UDashboardGroup unit="rem" storage="local" storage-key="ext-dashboard">
    <UDashboardSidebar
      id="ext-navigation"
      collapsible
      resizable
      mode="slideover"
      :menu="{ inset: false, ui: { content: 'max-w-none' } }"
      :min-size="14"
      :default-size="17"
      :max-size="28"
      :collapsed-size="0"
      :ui="{
        root: 'overflow-hidden transition-[width] duration-200 ease-out data-[dragging=true]:transition-none lg:data-[collapsed=true]:min-w-0 lg:data-[collapsed=true]:border-e-0',
        header: 'min-w-56',
        body: 'min-w-56 gap-2',
        footer: 'min-w-56 border-t border-default pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
      }"
      aria-label="공개 폴더와 메모"
      data-testid="ext-navigation"
    >
      <template #toggle="{ toggle }">
        <UButton icon="i-lucide-chevrons-left" color="neutral" variant="ghost" class="size-10 shrink-0 justify-center" aria-label="공개 목록 닫기" data-testid="ext-navigation-close" @click="toggle" />
      </template>
      <template #header>
        <div class="flex w-full items-center gap-1.5" data-testid="ext-brand">
          <img src="/memo-logo.png" alt="" aria-hidden="true" width="28" height="28" class="size-7 shrink-0 object-contain" />
          <div class="min-w-0">
            <span class="block font-semibold">Jun's Memo</span>
            <p class="mt-0.5 text-[11px] leading-tight break-keep text-muted" data-testid="ext-public-notice">공개된 메모만 보입니다.</p>
          </div>
        </div>
      </template>
      <nav aria-label="공개 항목 탐색" :aria-busy="status === 'pending'">
        <div v-if="status === 'pending'" class="space-y-3 px-2" role="status" aria-label="공개 목록을 불러오는 중">
          <USkeleton v-for="index in 4" :key="index" class="h-7 w-full" />
        </div>
        <div v-else-if="error" class="space-y-3" data-testid="ext-navigation-error">
          <UAlert title="공개 목록을 불러오지 못했습니다" color="error" variant="subtle" />
          <UButton color="neutral" variant="outline" data-testid="ext-navigation-retry" @click="refresh()">다시 시도</UButton>
        </div>
        <MemoTree v-else-if="items.length" v-model:expanded="expanded" :items="items" :model-value="selected" data-testid="ext-tree">
          <template #item="{ item, handleToggle }">
            <MemoTreeRow
              :item="item"
              :expanded="expanded.includes(String(item.value))"
              :toggle-test-id="String(item.toggleTestId)"
              :data-testid="String(item.testId)"
              @click.stop="openItem(String(item.url))"
              @toggle="handleToggle"
            />
          </template>
        </MemoTree>
        <p v-else class="px-2 py-4 text-sm text-muted" data-testid="ext-navigation-empty">공개된 폴더와 메모가 없습니다.</p>
      </nav>
      <template #footer>
        <footer class="flex w-full items-center justify-between gap-2 text-xs text-muted" data-testid="ext-developer">
          <div class="flex items-center gap-1 whitespace-nowrap">
            <span>© {{ year }} · Junjak ·</span>
            <UTooltip text="소스 코드">
              <UButton to="https://github.com/Junjak-Personal/personal-memo" target="_blank" rel="noopener noreferrer" icon="i-lucide-git-fork" color="neutral" variant="ghost" size="xs" class="size-9 justify-center text-muted lg:size-7" aria-label="소스 코드" data-testid="ext-source-open" />
            </UTooltip>
          </div>
          <div class="flex items-center gap-1">
            <UTooltip text="GitHub 프로필">
              <UButton to="https://github.com/JunjaK" target="_blank" rel="noopener noreferrer" icon="i-lucide-github" color="neutral" variant="ghost" size="xs" class="size-9 justify-center text-muted lg:size-7" aria-label="GitHub 프로필" data-testid="ext-github-open" />
            </UTooltip>
            <UTooltip text="이메일">
              <UButton to="mailto:haring157@gmail.com" icon="i-material-symbols-mail" color="neutral" variant="ghost" size="xs" class="size-9 justify-center text-muted lg:size-7" aria-label="이메일" data-testid="ext-email-open" />
            </UTooltip>
          </div>
        </footer>
      </template>
    </UDashboardSidebar>

    <UDashboardPanel id="ext-main" :ui="{ root: 'isolate min-h-0', body: 'p-0 sm:p-0 gap-0 sm:gap-0 pb-[env(safe-area-inset-bottom)] sm:pb-[env(safe-area-inset-bottom)]' }">
      <template #header>
        <UDashboardNavbar :ui="{ center: 'flex min-w-0 flex-1' }">
          <template #toggle>
            <UDashboardSidebarToggle icon="i-lucide-chevrons-right" class="size-11 justify-center" aria-label="공개 목록 열기" data-testid="ext-navigation-open" />
          </template>
          <template #leading>
            <UDashboardSidebarCollapse data-testid="ext-navigation-collapse" />
          </template>
          <UInputMenu
            v-model="selectedSearchMemo"
            v-model:search-term="searchInput"
            :items="searchItems"
            label-key="title"
            :filter-fields="['title']"
            :clear="{ variant: 'ghost', 'aria-label': '검색 지우기', 'data-testid': 'ext-search-clear' }"
            open-on-click
            open-on-focus
            icon="i-material-symbols-search"
            placeholder="공개 메모 제목 검색"
            aria-label="공개 메모 제목 검색"
            :loading="status === 'pending'"
            :disabled="status === 'pending' || !!error"
            :ui="{ base: 'h-11 lg:h-9', item: 'min-h-11 lg:min-h-0', itemLabel: 'truncate' }"
            class="w-full min-w-0"
            data-testid="ext-search-input"
            @update:model-value="selectSearchMemo"
          >
            <template #item-leading><UIcon name="i-material-symbols-description-outline" class="size-4 shrink-0 text-muted" /></template>
            <template #item-label="{ item, index }"><span :data-testid="`ext-search-result-${index}`">{{ item.title }}</span></template>
            <template #empty="{ searchTerm }">{{ searchTerm ? '일치하는 공개 메모가 없습니다.' : '공개된 메모가 없습니다.' }}</template>
          </UInputMenu>
        </UDashboardNavbar>
      </template>
      <template #body><slot /></template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
