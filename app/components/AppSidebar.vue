<script setup lang="ts">
/**
 * 왼쪽 사이드바 — 검색, 폴더·메모 트리, 태그, 할 일·캘린더·휴지통 (설계문서 §7.4).
 * 할 일인 메모는 트리 줄의 아이콘 자리에 체크박스가 선다 — 줄을 누르면 열고, 체크박스를 누르면 끝낸다.
 * 태그를 누르면 `#태그` 로 검색한다 — 태그 거르기와 글자 검색이 한 검색창을 쓴다.
 * PC 에서는 접을 수 있고, 모바일에서는 ≡ 를 누르면 왼쪽에서 전체 화면으로 밀려 들어온다(slideover, 폭 제한 없음).
 * (처음엔 mode="modal" 이었는데 Nuxt UI 가 전체 화면 modal 의 애니메이션을 꺼 둬서 뚝 나타났다.)
 * PC 에서는 메모·폴더를 끌어 다른 폴더나 최상위로 옮긴다 (useTreeDragDrop). 폰은 메뉴로 옮긴다.
 */
import type { DropdownMenuItem, NavigationMenuItem, TreeItem } from '@nuxt/ui'
import type { FolderNode, MemoMeta, SearchHit } from '#shared/types/memo'
import type { Dragged } from '~/composables/useTreeDragDrop'

type SidebarMenuItem = DropdownMenuItem & { testId: string }

const route = useRoute()
const { clear: clearSession } = useUserSession()
const toast = useToast()

const { tree, error: treeError, refresh } = useMemoTree()
const { creating, createMemo } = useCreateMemo()
const queue = useStructureQueue()
const folders = useFolderActions({ onRelocated: relocate })
const dnd = useTreeDragDrop(relocate)
const todo = useTodo()
const activeMemo = useActiveMemo()

const sidebarOpen = ref(false)
const expanded = ref<string[]>([])
const searchInput = ref('')
const appliedQuery = ref('')
const results = ref<SearchHit[] | null>(null)
const searching = ref(false)
const movingMemo = ref<Pick<MemoMeta, 'id' | 'title' | 'folder'> | null>(null)
const removingMemo = ref<string | null>(null)

const memoMoveOpen = computed({
  get: () => movingMemo.value !== null,
  set: (open: boolean) => {
    if (!open) movingMemo.value = null
  },
})

const currentId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
/** 그리는 트리 — 대기 중인 옮기기·이름 바꾸기까지 얹은 것 (useStructureQueue) */
const view = queue.view
const currentFolder = computed(() => view.value?.memos.find((m) => m.id === currentId.value)?.folder ?? '')
const items = computed(() => (view.value ? toItems(view.value.folders, view.value.memos, '') : []))
const selected = computed(() => findItem(items.value, currentId.value))
/** 태그별 메모 수 — 많은 것부터 */
const tagCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const memo of view.value?.memos ?? []) for (const tag of memo.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
})

/** 안 끝난 할 일 수 — 「할 일」 옆에 보인다 */
const openTodos = computed(() => view.value?.memos.filter((m) => m.done === false).length ?? 0)
const links = computed<NavigationMenuItem[]>(() => [
  {
    label: '할 일',
    icon: 'i-material-symbols-checklist',
    to: '/todo',
    badge: openTodos.value ? { label: String(openTodos.value), color: 'neutral', variant: 'subtle' } : undefined,
  },
  { label: '캘린더', icon: 'i-material-symbols-calendar-month-outline', to: '/calendar' },
  { label: '휴지통', icon: 'i-material-symbols-delete-outline', to: '/trash' },
])

/** 터치 화면에서는 끌기를 켜지 않는다 — 스크롤과 다투고 iOS 웹뷰에서 믿을 수 없다 */
const coarsePointer = window.matchMedia('(pointer: coarse)').matches
// 길게 누른 손가락을 뗄 때 생기는 click 으로 메모가 열리거나 폴더가 접히지 않게 한다.
let pressedMenuRow: string | null = null

onMounted(async () => {
  // 앱을 내리거나 탭을 바꾸면 대기 중인 폴더 구조 변경을 기다리지 않고 반영한다
  document.addEventListener('visibilitychange', onVisibility)
  await refresh()
  // 처음엔 폴더를 전부 펼쳐 둔다. 이후 접고 펼친 상태는 사용자가 정한다
  expanded.value = folderKeys(tree.value?.folders ?? [])
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
})

function onVisibility() {
  if (document.visibilityState === 'hidden') void queue.apply()
}

function folderKeys(folders: FolderNode[]): string[] {
  return folders.flatMap((f) => [`folder:${f.path}`, ...folderKeys(f.children)])
}

/**
 * 옮기거나 이름을 바꾼 뒤 — 옮긴 폴더의 펼침 상태를 새 경로로 옮기고, 옮겨 간 자리(와 위 폴더들)를 펼친다.
 * from 은 옮긴 폴더의 원래 경로(메모를 옮겼으면 null), to 는 새 경로(메모면 옮겨 간 폴더).
 */
function relocate(from: string | null, to: string) {
  let keys = expanded.value
  if (from) {
    const old = `folder:${from}`
    keys = keys.map((k) => (k === old || k.startsWith(`${old}/`) ? `folder:${to}${k.slice(old.length)}` : k))
  }
  const target = from ? parentOf(to) : to
  const ancestors = target ? target.split('/').map((_, i, parts) => `folder:${parts.slice(0, i + 1).join('/')}`) : []
  expanded.value = [...new Set([...keys, ...ancestors])]
}

function memoItem(memo: MemoMeta): TreeItem {
  return {
    kind: 'memo',
    folder: memo.folder,
    label: memo.title || '제목 없음',
    value: memo.id,
    done: memo.done,
    icon: memo.unreadable ? 'i-material-symbols-warning-outline' : 'i-material-symbols-description-outline',
    onSelect: () => navigateTo(memoPath(memo.id)),
  }
}

/** 폴더 먼저, 그 안의 메모는 최근 수정 순 */
function toItems(folders: FolderNode[], memos: MemoMeta[], parent: string): TreeItem[] {
  const subfolders: TreeItem[] = folders.map((folder) => ({
    kind: 'folder',
    label: folder.name,
    value: `folder:${folder.path}`,
    path: folder.path,
    icon: 'i-material-symbols-folder-outline',
    children: toItems(folder.children, memos, folder.path),
  }))
  const own = memos
    .filter((m) => m.folder === parent)
    .sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? ''))
    .map(memoItem)
  return [...subfolders, ...own]
}

/** 폴더 줄의 메뉴 — PC는 ⋯, 폰은 길게 누르기 */
function folderMenu(path: string): SidebarMenuItem[][] {
  return [
    [
      { label: '여기에 새 메모', icon: 'i-material-symbols-note-add-outline', disabled: creating.value, testId: 'sidebar-folder-create-memo', onSelect: () => void createInFolder(path) },
      { label: '하위 폴더 만들기', icon: 'i-material-symbols-create-new-folder-outline', testId: 'sidebar-folder-create-folder', onSelect: () => folders.startCreate(path) },
      { label: '이름 바꾸기', icon: 'i-material-symbols-edit-outline', testId: 'sidebar-folder-rename-folder', onSelect: () => folders.startRename(path) },
      { label: '다른 폴더로 옮기기', icon: 'i-material-symbols-drive-file-move-outline', testId: 'sidebar-folder-move-folder', onSelect: () => folders.startMove(path) },
    ],
    [{ label: '폴더 지우기', icon: 'i-material-symbols-folder-delete-outline', color: 'error', testId: 'sidebar-folder-delete-folder', onSelect: () => void folders.remove(path) }],
  ]
}

function rowMenu(item: TreeItem): SidebarMenuItem[][] {
  if (item.kind === 'folder') return folderMenu(String(item.path))
  const memo = view.value?.memos.find((m) => m.id === item.value)
  if (!memo) return []
  return [
    [
      { label: '여기에 새 메모', icon: 'i-material-symbols-note-add-outline', disabled: creating.value, testId: 'sidebar-memo-create-memo', onSelect: () => void createInFolder(memo.folder) },
      { label: '다른 폴더로 옮기기', icon: 'i-material-symbols-drive-file-move-outline', disabled: removingMemo.value !== null, testId: 'sidebar-memo-move-memo', onSelect: () => (movingMemo.value = memo) },
    ],
    [{ label: '메모 삭제', icon: 'i-material-symbols-delete-outline', color: 'error', disabled: removingMemo.value !== null, testId: 'sidebar-memo-delete-memo', onSelect: () => void removeMemo(memo.id) }],
  ]
}

async function createInFolder(folder: string) {
  if (await queue.apply()) await createMemo(folder)
}

function moveMemo(folder: string) {
  const memo = movingMemo.value
  if (!memo) return
  queue.push({ kind: 'moveMemo', id: memo.id, title: memo.title, folder })
  relocate(null, folder)
  movingMemo.value = null
}

/** 기존 메모 메뉴와 같은 삭제: 먼저 저장하고 휴지통으로 보낸 뒤 되돌리기를 제공한다. */
async function removeMemo(id: string) {
  if (removingMemo.value !== null) return
  removingMemo.value = id
  try {
    if (!(await queue.apply())) return
    if (activeMemo.isOpen(id) && !(await activeMemo.flush())) {
      toast.add({ color: 'error', title: '저장하지 못해서 지우지 않았습니다', description: '저장 상태를 먼저 확인하세요.' })
      return
    }
    const { trashPath } = await $fetch<{ trashPath: string }>(`/api/memos/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await refresh()
    sidebarOpen.value = false
    toast.add({
      title: '휴지통으로 옮겼습니다',
      actions: [{ label: '되돌리기', color: 'neutral', variant: 'outline', onClick: () => void restoreMemo(trashPath) }],
    })
    if (currentId.value === id) await navigateTo('/')
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '지우지 못했습니다') })
  } finally {
    removingMemo.value = null
  }
}

async function restoreMemo(trashPath: string) {
  try {
    const restored = await $fetch<MemoMeta>('/api/trash/restore', { method: 'POST', body: { path: trashPath } })
    await refresh()
    await navigateTo(memoPath(restored.id))
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '되돌리지 못했습니다'), description: '휴지통 화면에서 복원하세요.' })
  }
}

function onContextOpen(item: TreeItem, open: boolean) {
  if (open) pressedMenuRow = String(item.value)
}

function suppressPressClick(event: MouseEvent, item: TreeItem) {
  if (pressedMenuRow !== String(item.value)) return
  pressedMenuRow = null
  event.preventDefault()
  event.stopPropagation()
}

/** 트리 항목 → 끄는 대상. 항목의 추가 필드(kind·path·folder)는 위 toItems 가 넣는다 */
function dragged(item: TreeItem): Dragged {
  return item.kind === 'folder'
    ? { kind: 'folder', path: String(item.path), label: String(item.label) }
    : { kind: 'memo', id: String(item.value), folder: String(item.folder), label: String(item.label) }
}


function findItem(list: TreeItem[], value: string | null): TreeItem | undefined {
  if (!value) return undefined
  for (const item of list) {
    if (item.value === value) return item
    const found = item.children && findItem(item.children, value)
    if (found) return found
  }
  return undefined
}

async function applySearch() {
  appliedQuery.value = searchInput.value.trim()
  if (!appliedQuery.value) {
    results.value = null
    return
  }
  searching.value = true
  try {
    results.value = await $fetch<SearchHit[]>('/api/search', { query: { q: appliedQuery.value } })
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '검색하지 못했습니다') })
  } finally {
    searching.value = false
  }
}

function searchTag(tag: string) {
  searchInput.value = `#${tag}`
  void applySearch()
}

function resetSearch() {
  searchInput.value = ''
  appliedQuery.value = ''
  results.value = null
}

async function logout() {
  await clearSession()
  await navigateTo('/login')
}
</script>

<template>
  <UDashboardSidebar
    v-model:open="sidebarOpen"
    collapsible
    resizable
    mode="slideover"
    :menu="{ inset: false, ui: { content: 'max-w-none' } }"
    :min-size="14"
    :default-size="17"
    :max-size="28"
    :collapsed-size="0"
    :ui="{
      /*
       * 접기·펼치기는 폭을 0 ↔ 원래 폭으로 움직여 미끄러지듯. display:none 으로 숨기면 애니메이션을 못 건다.
       * 기본 스타일의 min-w-16(64px) 을 접힐 때 0 으로 — 안 그러면 폭 0 으로 접어도 아이콘 줄이 남는다.
       * 손으로 폭을 끄는 동안(dragging)은 애니메이션을 끈다 — 손을 따라오지 못하고 늦게 끌려온다.
       * 안쪽은 최소 폭을 지켜 접히는 동안 글자가 줄바꿈되며 찌그러지지 않고 가장자리에서 잘려 나간다.
       */
      root: 'overflow-hidden transition-[width] duration-200 ease-out data-[dragging=true]:transition-none lg:data-[collapsed=true]:min-w-0 lg:data-[collapsed=true]:border-e-0',
      header: 'min-w-56',
      body: 'min-w-56',
      // 홈 인디케이터·둥근 모서리 아래로 깔리지 않게 — viewport-fit=cover 라 화면 끝까지 그려진다 (아이패드에서 잘려 보였다)
      footer: 'min-w-56 border-t border-default pb-[calc(0.5rem+env(safe-area-inset-bottom))]',
    }"
  >
    <template #toggle="{ toggle }">
      <UButton
        icon="i-material-symbols-close"
        color="neutral"
        variant="outline"
        class="size-11 shrink-0 justify-center"
        aria-label="메뉴 닫기"
        data-testid="sidebar-menu-close"
        @click="toggle"
      />
    </template>

    <template #header>
      <div class="flex w-full items-center justify-between gap-2">
        <NuxtLink to="/" class="flex items-center gap-1.5 font-semibold" data-testid="sidebar-home-link">
          <img src="/memo-logo.png" alt="" aria-hidden="true" width="28" height="28" class="size-7 object-contain" />
          memo
        </NuxtLink>
        <div class="flex items-center">
          <UTooltip text="새 폴더">
            <UButton
              icon="i-material-symbols-create-new-folder-outline"
              color="neutral"
              variant="ghost"
              class="size-11 justify-center lg:size-8"
              aria-label="새 폴더"
              data-testid="sidebar-new-folder-button"
              @click="folders.startCreate('')"
            />
          </UTooltip>
          <UTooltip text="새 메모">
            <UButton
              icon="i-material-symbols-add"
              color="neutral"
              variant="ghost"
              class="size-11 justify-center lg:size-8"
              :loading="creating"
              aria-label="새 메모"
              data-testid="sidebar-new-button"
              @click="createMemo(currentFolder)"
            />
          </UTooltip>
        </div>
      </div>
    </template>

    <form class="flex gap-1" @submit.prevent="applySearch">
      <UInput
        v-model="searchInput"
        icon="i-material-symbols-search"
        placeholder="검색"
        class="flex-1"
        data-testid="sidebar-search-input"
      >
        <template v-if="searchInput || appliedQuery" #trailing>
          <UButton
            icon="i-material-symbols-close"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="검색 지우기"
            data-testid="sidebar-search-reset"
            @click="resetSearch"
          />
        </template>
      </UInput>
    </form>

    <div v-if="results" class="flex flex-col gap-1" data-testid="sidebar-search-results">
      <p class="px-1 text-xs text-muted">「{{ appliedQuery }}」 {{ results.length }}건</p>
      <NuxtLink
        v-for="hit in results"
        :key="hit.id"
        :to="memoPath(hit.id)"
        class="rounded-md px-2 py-1.5 hover:bg-elevated"
        :class="hit.id === currentId && 'bg-elevated'"
      >
        <p class="truncate text-sm font-medium">{{ hit.title || '제목 없음' }}</p>
        <p class="truncate text-xs text-muted">{{ hit.snippet }}</p>
        <p v-if="hit.tags.length" class="truncate text-xs text-dimmed">{{ hit.tags.map((t) => `#${t}`).join(' ') }}</p>
      </NuxtLink>
      <p v-if="!results.length && !searching" class="px-1 py-4 text-center text-sm text-muted">찾은 메모가 없습니다</p>
    </div>

    <template v-else>
      <p v-if="treeError" class="px-1 text-sm text-error">{{ treeError }}</p>
      <p v-else class="px-1 text-xs text-muted lg:hidden">폴더·메모를 길게 누르면 메뉴가 열립니다</p>
      <UTree
        v-if="!treeError"
        v-model:expanded="expanded"
        :items="items"
        :model-value="selected"
        :get-key="(item: TreeItem) => String(item.value)"
        :as="{ link: 'div' }"
        :ui="{ link: 'min-h-11 py-0 lg:min-h-0 lg:py-1.5', listWithChildren: 'border-s border-default animate-tree-open' }"
        color="neutral"
        data-testid="sidebar-tree"
      >
        <!--
          줄 전체를 직접 그린다 — 끌기·놓기를 줄에 걸어야 해서. 줄 요소는 div 로 둔다(as.link):
          button 안의 요소는 Firefox 에서 끌기 이벤트가 나지 않는다.
          폴더 줄 끝의 ⋯ 메뉴와 펼침 화살표도 여기서 그린다 (기본 화살표는 이 슬롯을 쓰면 빠진다).
        -->
        <template #item="{ item, handleToggle }">
          <!-- 기존 메뉴의 길게 누르기: 움직이거나 손을 떼면 대기를 취소해서 목록 스크롤을 막지 않는다. -->
          <UContextMenu
            :items="rowMenu(item)"
            :ui="{ item: 'min-h-11 lg:min-h-0' }"
            @update:open="onContextOpen(item, $event)"
          >
            <div
              class="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1"
              :class="item.kind === 'folder' && dnd.over.value === item.path && 'bg-primary/10 ring-1 ring-primary'"
              :draggable="!coarsePointer"
              :data-testid="item.kind === 'folder' ? 'sidebar-folder-row' : 'sidebar-memo-row'"
              @pointerdown="pressedMenuRow = null"
              @click.capture="suppressPressClick($event, item)"
              @dragstart="dnd.start($event, dragged(item))"
              @dragend="dnd.end"
              @dragenter="item.kind === 'folder' && dnd.enter($event, String(item.path))"
              @dragover="item.kind === 'folder' && dnd.enter($event, String(item.path))"
              @dragleave="item.kind === 'folder' && dnd.leave(String(item.path))"
              @drop="item.kind === 'folder' && dnd.drop($event, String(item.path))"
            >
              <!-- 할 일이면 아이콘 자리에 체크박스. 누름이 줄까지 올라가면 메모가 열리므로 여기서 멈춘다 -->
              <span v-if="item.kind === 'memo' && item.done !== null" class="flex size-5 shrink-0 items-center justify-center" @click.stop>
                <UCheckbox
                  :model-value="item.done === true"
                  :disabled="todo.pending.value.includes(String(item.value))"
                  :aria-label="item.done ? '안 끝난 것으로 되돌리기' : '끝냄'"
                  data-testid="sidebar-todo-check"
                  @update:model-value="todo.setDone(String(item.value), item.done !== true)"
                />
              </span>
              <UIcon v-else :name="String(item.icon)" class="size-5 shrink-0" />
              <span class="truncate" :class="item.done === true && 'text-muted line-through'">{{ item.label }}</span>
              <span class="ms-auto flex shrink-0 items-center">
                <UDropdownMenu :items="rowMenu(item)" :content="{ align: 'start' }">
                  <UButton
                    icon="i-material-symbols-more-horiz"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :aria-label="item.kind === 'folder' ? '폴더 메뉴' : '메모 메뉴'"
                    class="hidden opacity-60 hover:opacity-100 lg:inline-flex"
                    :data-testid="item.kind === 'folder' ? 'sidebar-folder-menu' : 'sidebar-memo-menu'"
                    @pointerdown.stop
                    @click.stop
                  />
                  <template #item-label="{ item: menuItem }">
                    <span :data-testid="menuItem.testId">{{ menuItem.label }}</span>
                  </template>
                </UDropdownMenu>
                <!-- 펼침 여부는 사이드바가 들고 있는 expanded 로 판단한다 — item 슬롯이 넘기는 값으로는 화살표가 늘 「접힘」으로 그려졌다 -->
                <UButton
                  v-if="item.kind === 'folder'"
                  :icon="expanded.includes(String(item.value)) ? 'i-material-symbols-keyboard-arrow-up' : 'i-material-symbols-keyboard-arrow-down'"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  class="size-11 justify-center lg:size-6"
                  :aria-label="expanded.includes(String(item.value)) ? '폴더 접기' : '폴더 펼치기'"
                  :aria-expanded="expanded.includes(String(item.value))"
                  data-testid="sidebar-folder-toggle"
                  @pointerdown.stop
                  @click.stop="handleToggle"
                />
              </span>
            </div>
            <template #item-label="{ item: menuItem }">
              <span :data-testid="menuItem.testId">{{ menuItem.label }}</span>
            </template>
          </UContextMenu>
        </template>
      </UTree>

      <!-- 끄는 동안만 — 최상위로 옮길 자리 -->
      <div
        v-if="dnd.dragging.value && dnd.canDrop('')"
        class="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted"
        :class="dnd.over.value === '' ? 'border-primary bg-primary/10 text-primary' : 'border-default'"
        data-testid="sidebar-drop-root"
        @dragenter="dnd.enter($event, '')"
        @dragover="dnd.enter($event, '')"
        @dragleave="dnd.leave('')"
        @drop="dnd.drop($event, '')"
      >
        여기에 놓으면 최상위로 옮깁니다
      </div>

      <section v-if="tagCounts.length" class="mt-2 flex flex-col gap-1.5 px-1" data-testid="sidebar-tags">
        <p class="text-xs text-muted">태그</p>
        <div class="flex flex-wrap gap-1">
          <UButton
            v-for="[tag, count] in tagCounts"
            :key="tag"
            color="neutral"
            variant="outline"
            size="xs"
            :data-testid="`sidebar-tag-${tag}`"
            @click="searchTag(tag)"
          >
            #{{ tag }}
            <span class="text-dimmed">{{ count }}</span>
          </UButton>
        </div>
      </section>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <!-- 폴더 구조 변경 대기 — 조용히 기다리지 않는다. 취소하면 트리가 실제 폴더 상태로 돌아간다 -->
        <div
          v-if="queue.ops.value.length"
          class="flex items-center gap-2 rounded-md bg-elevated px-2 py-1.5 text-xs"
          data-testid="sidebar-pending"
        >
          <UIcon name="i-material-symbols-schedule-outline" class="size-4 shrink-0 text-muted" />
          <span class="flex-1 truncate">폴더 변경 {{ queue.ops.value.length }}건 반영 대기</span>
          <UButton size="xs" color="neutral" variant="outline" data-testid="sidebar-pending-cancel" @click="queue.cancel()">취소</UButton>
          <UButton size="xs" data-testid="sidebar-pending-apply" @click="queue.apply()">지금 반영</UButton>
        </div>
        <UNavigationMenu :items="links" orientation="vertical" :ui="{ link: 'min-h-11 lg:min-h-0' }" class="w-full" />
        <div class="flex justify-end border-t border-default pt-2">
          <UButton
            icon="i-material-symbols-logout"
            color="neutral"
            variant="outline"
            class="min-h-11 justify-center lg:min-h-0"
            data-testid="sidebar-logout-button"
            @click="logout"
          >
            로그아웃
          </UButton>
        </div>
      </div>
    </template>
  </UDashboardSidebar>

  <FolderPickDialog
    v-model:open="folders.moveOpen.value"
    :title="`「${folders.moving.value ?? ''}」 옮기기`"
    :current="parentOf(folders.moving.value ?? '')"
    :exclude="folders.moving.value ?? undefined"
    @pick="folders.move"
  />

  <FolderPickDialog
    v-if="movingMemo"
    v-model:open="memoMoveOpen"
    :title="`「${movingMemo?.title || '제목 없음'}」 옮기기`"
    :current="movingMemo?.folder ?? ''"
    @pick="moveMemo"
  />

  <FolderNameDialog
    v-model:open="folders.dialogOpen.value"
    :title="folders.dialog.value.mode === 'rename' ? '폴더 이름 바꾸기' : '새 폴더'"
    :initial="folders.dialog.value.mode === 'rename' ? folders.dialog.value.name : ''"
    :submit-label="folders.dialog.value.mode === 'rename' ? '바꾸기' : '만들기'"
    :busy="folders.busy.value"
    @submit="folders.submit"
  />
</template>
