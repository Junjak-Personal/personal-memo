<script setup lang="ts">
/**
 * 왼쪽 사이드바 — 검색, 폴더·메모 트리, 태그, 할 일·캘린더·휴지통 (설계문서 §7.4).
 * 할 일인 메모는 트리 줄의 아이콘 자리에 체크박스가 선다 — 줄을 누르면 열고, 체크박스를 누르면 끝낸다.
 * 태그는 하단 탐색에서 전용 화면으로 연다 — 검색창에서는 그대로 `#태그` 로 거를 수 있다.
 * PC 에서는 접을 수 있고, 모바일에서는 ≡ 를 누르면 왼쪽에서 전체 화면으로 밀려 들어온다(slideover, 폭 제한 없음).
 * (처음엔 mode="modal" 이었는데 Nuxt UI 가 전체 화면 modal 의 애니메이션을 꺼 둬서 뚝 나타났다.)
 * PC 에서는 메모·폴더를 끌어 다른 폴더나 최상위로 옮기고, 같은 폴더 안 순서를 바꾼다 (useTreeDragDrop).
 * 폰은 메뉴로 옮기고 「위로」「아래로」 로 순서를 바꾼다. 순서는 폴더마다 `.order.json` (설계문서 §3.6).
 */
import type { DropdownMenuItem, TreeItem } from '@nuxt/ui'
import type { VNode } from 'vue'
import { isNavigationFailure, NavigationFailureType, type RouteLocationNormalized } from 'vue-router'
import type { FolderNode, MemoMeta, SearchHit } from '#shared/types/memo'
import { todayKst } from '#shared/utils/memo-date'
import { applyOrder, byCreatedDesc, byName, EMPTY_ORDER, moveKey, stepKey } from '#shared/utils/order'
import { compareDoneTodos, compareOpenTodos, TODO_FOLDER } from '#shared/utils/todo'
import type { Dragged, OrderSlot, RowTarget } from '~/composables/useTreeDragDrop'

type SidebarMenuItem = DropdownMenuItem & { testId: string }

const route = useRoute()
const router = useRouter()
const nuxtApp = useNuxtApp()
const { clear: clearSession } = useUserSession()
const toast = useToast()

const { tree, error: treeError, ensure, refresh, setFolderOrder } = useMemoTree()
const { moveToTrash, notifyMoved } = useMemoTrashActions()
const { creating, createMemo } = useCreateMemo()
const queue = useStructureQueue()
const folders = useFolderActions({ onRelocated: relocate })
const dnd = useTreeDragDrop({ onRelocated: relocate, onReorder, pinned: (key) => key === TODO_FOLDER })
const todo = useTodo()
const activeMemo = useActiveMemo()
const navigation = useMemoNavigation()
const quickSwitch = useTemplateRef<{ show: () => void }>('quickSwitch')
const templatesDialog = useTemplateRef<{ show: () => Promise<void> }>('templatesDialog')

const mobileMenu = useMobileMenuNavigation()
const sidebarOpen = mobileMenu.open
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
/** 안 끝난 할 일 수 — 「할 일」 옆에 보인다 */
const openTodos = computed(() => view.value?.memos.filter((m) => m.done === false).length ?? 0)
/** 오늘(KST) — 앱을 켜 둔 채 날이 바뀌면 다시 앱으로 돌아올 때 고친다 (onVisibility) */
const today = ref(todayKst())
/** 오늘에 걸친 일정이 있나 — 구글 캘린더에 보이는 것과 같은 기준(끝낸 할 일 제외, 설계문서 §8.3) */
const hasTodayEvent = computed(
  () => view.value?.memos.some((m) => m.date && m.date <= today.value && (m.dateEnd ?? m.date) >= today.value && m.done !== true) ?? false,
)

interface FooterLink {
  label: string
  icon: string
  testId: string
  to: string
  /** 아이콘 위 빨간 뱃지 — 글자가 없으면 점 */
  chip?: { text?: string }
}

/** 하단 아이콘 줄 (2026-10-18 — 글자 버튼 6개가 정신없어 자주 쓰는 셋만 아이콘으로, 나머지는 ⋯ 메뉴) */
const links = computed<FooterLink[]>(() => [
  {
    label: openTodos.value ? `할 일 ${openTodos.value}개` : '할 일',
    icon: 'i-material-symbols-checklist',
    to: '/todo',
    testId: 'sidebar-todo-link',
    chip: openTodos.value ? { text: openTodos.value > 99 ? '99+' : String(openTodos.value) } : undefined,
  },
  {
    label: hasTodayEvent.value ? '캘린더 (오늘 일정 있음)' : '캘린더',
    icon: 'i-material-symbols-calendar-month-outline',
    to: '/calendar',
    testId: 'sidebar-calendar-link',
    chip: hasTodayEvent.value ? {} : undefined,
  },
  { label: '태그', icon: 'i-material-symbols-label-outline', to: '/tags', testId: 'sidebar-tags-link' },
])

/** ⋯ 메뉴 — 잘 안 가는 것들 */
const moreMenu: SidebarMenuItem[] = [
  { label: '내 템플릿', icon: 'i-material-symbols-note-stack-outline', testId: 'sidebar-templates-button', onSelect: () => void templatesDialog.value?.show() },
  { label: '휴지통', icon: 'i-material-symbols-delete-outline', to: '/trash', testId: 'sidebar-trash-link' },
  { label: 'AI 연결', icon: 'i-material-symbols-smart-toy-outline', to: '/ai', testId: 'sidebar-ai-link' },
  { label: '로그아웃', icon: 'i-material-symbols-logout', testId: 'sidebar-logout-button', onSelect: () => void logout() },
]
/** 메뉴 안의 화면에 있으면 ⋯ 를 켜진 것으로 */
const moreActive = computed(() => moreMenu.some((item) => item.to && route.path.startsWith(String(item.to))))

/** 터치 화면에서는 끌기를 켜지 않는다 — 스크롤과 다투고 iOS 웹뷰에서 믿을 수 없다 */
const coarsePointer = window.matchMedia('(pointer: coarse)').matches
// 길게 누른 손가락을 뗄 때 생기는 click 으로 메모가 열리거나 폴더가 접히지 않게 한다.
let pressedMenuRow: string | null = null

/*
 * 기본 autoClose는 Nuxt의 route 갱신을 보고 닫는다. 메모 페이지는 재사용되어 새 문서를 받기 전에
 * route가 먼저 바뀌고, 다른 메뉴는 본문 페이드와 메뉴 닫힘이 겹쳤다. 목적 화면 준비와 닫힘을 맞춘다.
 * 저장 가드는 그대로 router가 실행한다. 타이머로 닫지 않아서 느린 저장·로딩, 연속 선택에도 기다린다.
 */
const routeSequences = new WeakMap<object, number>()
const pageDestinations = new WeakMap<VNode, NonNullable<typeof mobileMenu.pending.value>>()
const removeMenuHooks = [
  router.beforeEach((to, from) => {
    mobileMenu.begin({ path: to.fullPath, memoId: to.params.id !== from.params.id ? menuMemoId(to) : null })
    if (mobileMenu.pending.value) routeSequences.set(to, mobileMenu.pending.value.sequence)
  }),
  router.beforeResolve((to) => {
    if (!sidebarOpen.value) return
    // 전체 화면 메뉴가 이미 가리고 있다. 본문은 즉시 교체하고 기존 slide-out만으로 새 화면을 드러낸다.
    to.meta.pageTransition = { name: 'menu-page', mode: 'out-in', duration: 0 }
  }),
  router.afterEach((to, from, failure) => {
    if (failure) {
      // 중복 경로에는 beforeEach가 없다. 느린 B 이동 중 현재 A를 다시 고른 것도 명시적으로 정리한다.
      if (isNavigationFailure(failure, NavigationFailureType.duplicated)) {
        mobileMenu.duplicate(to.fullPath)
        return
      }
      // 빠른 연속 선택으로 취소된 이전 요청은 최신 메뉴를 닫지 않는다.
      if (!isNavigationFailure(failure, NavigationFailureType.cancelled)) mobileMenu.fail(to.fullPath, routeSequences.get(to))
      return
    }
    // 쿼리만 바뀌거나 첫 저장으로 메모 주소만 정리한 경우 새 Suspense가 생기지 않는다.
    const target = mobileMenu.pending.value
    const alreadyOpenMemo = target?.memoId && activeMemo.isOpen(target.memoId)
    if (alreadyOpenMemo || (to.matched.at(-1) === from.matched.at(-1) && to.params.id === from.params.id)) {
      if (target) void nextTick(() => mobileMenu.finish({ path: to.fullPath, memoId: alreadyOpenMemo ? target.memoId : null }, target.sequence))
    }
  }),
  router.onError((_error, to) => mobileMenu.fail(to.fullPath, routeSequences.get(to))),
  nuxtApp.hook('page:start', (component) => {
    const target = mobileMenu.pending.value
    if (component && target && target.path === router.currentRoute.value.fullPath) pageDestinations.set(component, target)
  }),
  nuxtApp.hook('page:finish', async (component) => {
    const current = router.currentRoute.value
    // 홈처럼 async setup이 없는 화면은 Suspense의 pending/page:start 없이 바로 resolve된다.
    // async 화면은 위에서 캡처한 요청을 우선해서 이전 branch의 늦은 완료를 걸러 낸다.
    const target = (component && pageDestinations.get(component)) ?? (
      component?.type === current.matched.at(-1)?.components?.default && mobileMenu.pending.value?.path === current.fullPath
        ? mobileMenu.pending.value
        : null
    )
    if (!target) return
    await nextTick()
    mobileMenu.finish({ path: target.path, memoId: null }, target.sequence)
  }),
]

function menuMemoId(to: RouteLocationNormalized) {
  return to.path.startsWith('/m/') && typeof to.params.id === 'string' ? to.params.id : null
}

onMounted(async () => {
  void navigation.ensure()
  // 앱을 내리거나 탭을 바꾸면 대기 중인 폴더 구조 변경을 기다리지 않고 반영한다
  document.addEventListener('visibilitychange', onVisibility)
  try { await ensure() } catch { /* 목록 오류는 treeError로 표시한다 */ }
  // 이 기기에 기억한 펼침 상태로 — 없으면 전부 접힘 (폴더가 깊어 전부 펼치면 너무 길었다, 2026-10-18)
  const saved = readExpanded() ?? []
  // 사라진 폴더의 키는 버린다. 트리를 못 받았으면 그대로 둔다 — 기억을 지우지 않게
  const known = tree.value ? new Set(folderKeys(tree.value.folders)) : null
  expanded.value = known ? saved.filter((k) => known.has(k)) : saved
})

// 접고 펼칠 때마다 이 기기에 기억한다 (처음 빈 값은 바뀐 게 아니라 적지 않는다)
watch(expanded, (keys) => writeExpanded(keys))

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  sidebarOpen.value = false
  for (const remove of removeMenuHooks) remove()
})

function onVisibility() {
  if (document.visibilityState === 'hidden') void queue.apply()
  else today.value = todayKst()
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

function memoItem(memo: MemoMeta, index: number, count: number): TreeItem {
  return {
    first: index === 0,
    last: index === count - 1,
    kind: 'memo',
    folder: memo.folder,
    label: memo.title || '제목 없음',
    value: memo.id,
    done: memo.done,
    public: memo.public,
    icon: memo.unreadable ? 'i-material-symbols-warning-outline' : 'i-material-symbols-description-outline',
    onSelect: () => navigateTo(memoPath(memo.id)),
  }
}

/** 폴더 먼저, 그다음 메모 — 각각 저장된 순서대로, 순서에 없는 것(새것)은 맨 위 (설계문서 §3.6) */
function toItems(folders: FolderNode[], memos: MemoMeta[], parent: string): TreeItem[] {
  const ordered = sortedFolders(folders, parent)
  const movable = ordered.filter((f) => !isPinned(f.path))
  const subfolders: TreeItem[] = ordered.map((folder) => ({
    kind: 'folder',
    label: folder.name,
    value: `folder:${folder.path}`,
    path: folder.path,
    first: movable[0] === folder,
    last: movable.at(-1) === folder,
    icon: folder.path === TODO_FOLDER ? 'i-material-symbols-folder-check-outline' : 'i-material-symbols-folder-outline',
    children: toItems(folder.children, memos, folder.path),
  }))
  const own = shownMemos(memos, parent)
  return [...subfolders, ...own.map((memo, i) => memoItem(memo, i, own.length))]
}

/** 「할 일」 폴더는 앱이 정한 특수 폴더라 최상위 맨 위에 고정, 아이콘도 따로 (2026-10-15 사용자 요청) */
function isPinned(path: string) {
  return path === TODO_FOLDER
}

function orderOf(folder: string) {
  return view.value?.orders[folder] ?? EMPTY_ORDER
}

function sortedFolders(folders: FolderNode[], parent: string) {
  const ordered = applyOrder(folders, orderOf(parent).folders, (f) => f.name, byName)
  return parent ? ordered : [...ordered].sort((a, b) => Number(isPinned(b.path)) - Number(isPinned(a.path)))
}

/**
 * 폴더 안 메모 전부, 순서대로 (숨긴 것 포함).
 * 「할 일」 폴더는 「할 일」 화면과 같은 날짜·중요도순이고 손으로 정하는 순서가 없다 (2026-10-22). 숨긴 끝낸 할 일은 뒤에.
 */
function sortedMemos(memos: MemoMeta[], folder: string) {
  if (folder === TODO_FOLDER) {
    const own = memos.filter((m) => m.folder === folder)
    return [...own.filter((m) => m.done !== true).sort(compareOpenTodos), ...own.filter((m) => m.done === true).sort(compareDoneTodos)]
  }
  return applyOrder(
    memos.filter((m) => m.folder === folder),
    orderOf(folder).memos,
    (m) => m.id,
    byCreatedDesc,
  )
}

/**
 * 「할 일」 폴더 안의 끝낸 할 일은 숨긴다 — 폴더 메뉴의 「완료 목록 보기」(/todo/done)에서 본다.
 * 할 일은 「할 일」 폴더에만 있다 (2026-10-22) — 폴더 밖 메모를 끌어 넣으면 할 일, 끌어 내면 일반 메모가 된다.
 */
function isHidden(memo: MemoMeta) {
  return memo.folder === TODO_FOLDER && memo.done === true
}

function shownMemos(memos: MemoMeta[], folder: string) {
  return sortedMemos(memos, folder).filter((m) => !isHidden(m))
}

function childFolders(folders: FolderNode[], parent: string): FolderNode[] {
  if (!parent) return folders
  for (const f of folders) {
    if (f.path === parent) return f.children
    if (parent.startsWith(`${f.path}/`)) return childFolders(f.children, parent)
  }
  return []
}

/**
 * 메모 순서를 바꿔 저장한다 — 끌어 놓기와 메뉴의 위로·아래로가 같이 쓴다. 「할 일」 폴더는 순서가 없어 여기로 오지 않는다.
 * 대기 중인 폴더 구조 변경이 있으면 먼저 반영한다 — 서버에 아직 없는 폴더의 순서를 쓰지 않게.
 */
async function reorderMemos(folder: string, change: (keys: string[]) => string[]) {
  if (!(await queue.apply())) return
  await setFolderOrder(folder, { memos: change(sortedMemos(view.value?.memos ?? [], folder).map((m) => m.id)) })
}

/** 하위 폴더 순서 — 이름으로 적는다. 고정된 「할 일」 은 빼고 */
async function reorderFolders(parent: string, change: (names: string[]) => string[]) {
  if (!(await queue.apply())) return
  const names = sortedFolders(childFolders(view.value?.folders ?? [], parent), parent)
    .filter((f) => !isPinned(f.path))
    .map((f) => f.name)
  await setFolderOrder(parent, { folders: change(names) })
}

function onReorder(dragged: Dragged, slot: OrderSlot) {
  if (dragged.kind === 'memo') {
    void reorderMemos(dragged.folder, (keys) => moveKey(keys, dragged.id, slot.key, slot.place))
  } else {
    void reorderFolders(parentOf(dragged.path), (names) => moveKey(names, dragged.label, nameOfPath(slot.key), slot.place))
  }
}

function nameOfPath(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** 메뉴의 위로·아래로 */
function orderMenu(item: TreeItem, testPrefix: string): SidebarMenuItem[] {
  const step = (delta: -1 | 1) =>
    item.kind === 'folder'
      ? reorderFolders(parentOf(String(item.path)), (names) => stepKey(names, String(item.label), delta))
      : reorderMemos(String(item.folder), (keys) => stepKey(keys, String(item.value), delta))
  return [
    { label: '위로', icon: 'i-material-symbols-arrow-upward', disabled: item.first === true, testId: `${testPrefix}-move-up`, onSelect: () => void step(-1) },
    { label: '아래로', icon: 'i-material-symbols-arrow-downward', disabled: item.last === true, testId: `${testPrefix}-move-down`, onSelect: () => void step(1) },
  ]
}

function rowTarget(item: TreeItem): RowTarget {
  return item.kind === 'folder' ? { kind: 'folder', path: String(item.path) } : { kind: 'memo', id: String(item.value), folder: String(item.folder) }
}

/** 순서로 놓을 자리 — 줄 위나 아래에 선을 긋는다 */
function slotClass(item: TreeItem) {
  const slot = dnd.slot.value
  if (!slot || slot.key !== (item.kind === 'folder' ? String(item.path) : String(item.value))) return ''
  return slot.place === 'before' ? 'shadow-[inset_0_2px_0_0_var(--ui-primary)]' : 'shadow-[inset_0_-2px_0_0_var(--ui-primary)]'
}

/** 폴더 줄의 메뉴 — PC는 ⋯, 폰은 길게 누르기 */
function folderMenu(item: TreeItem): SidebarMenuItem[][] {
  const path = String(item.path)
  // 「할 일」 폴더는 앱이 정한 자리라 이름·자리를 바꾸거나 지우거나 하위 폴더를 만들지 않는다 (2026-10-22, 서버도 거절)
  if (path === TODO_FOLDER) {
    return [
      [{ label: '완료 목록 보기', icon: 'i-material-symbols-task-alt', testId: 'sidebar-folder-done-list', onSelect: () => void navigateTo('/todo/done') }],
      [{ label: '여기에 새 메모', icon: 'i-material-symbols-note-add-outline', disabled: creating.value, testId: 'sidebar-folder-create-memo', onSelect: () => void createInFolder(path) }],
    ]
  }
  return [
    [
      { label: '여기에 새 메모', icon: 'i-material-symbols-note-add-outline', disabled: creating.value, testId: 'sidebar-folder-create-memo', onSelect: () => void createInFolder(path) },
      { label: '하위 폴더 만들기', icon: 'i-material-symbols-create-new-folder-outline', testId: 'sidebar-folder-create-folder', onSelect: () => folders.startCreate(path) },
      { label: '이름 바꾸기', icon: 'i-material-symbols-edit-outline', testId: 'sidebar-folder-rename-folder', onSelect: () => folders.startRename(path) },
      { label: '다른 폴더로 옮기기', icon: 'i-material-symbols-drive-file-move-outline', testId: 'sidebar-folder-move-folder', onSelect: () => folders.startMove(path) },
    ],
    orderMenu(item, 'sidebar-folder'),
    [{ label: '폴더 지우기', icon: 'i-material-symbols-folder-delete-outline', color: 'error', testId: 'sidebar-folder-delete-folder', onSelect: () => void folders.remove(path) }],
  ]
}

function rowMenu(item: TreeItem): SidebarMenuItem[][] {
  if (item.kind === 'folder') return folderMenu(item)
  const memo = view.value?.memos.find((m) => m.id === item.value)
  if (!memo) return []
  return [
    [
      { label: '여기에 새 메모', icon: 'i-material-symbols-note-add-outline', disabled: creating.value, testId: 'sidebar-memo-create-memo', onSelect: () => void createInFolder(memo.folder) },
      { label: '다른 폴더로 옮기기', icon: 'i-material-symbols-drive-file-move-outline', disabled: removingMemo.value !== null, testId: 'sidebar-memo-move-memo', onSelect: () => (movingMemo.value = memo) },
    ],
    // 「할 일」 폴더 안은 날짜·중요도순이라 위로·아래로가 없다
    ...(memo.folder === TODO_FOLDER ? [] : [orderMenu(item, 'sidebar-memo')]),
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
    const trashPath = await moveToTrash(id)
    sidebarOpen.value = false
    notifyMoved(trashPath)
    if (currentId.value === id) await navigateTo('/')
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '지우지 못했습니다') })
  } finally {
    removingMemo.value = null
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
    :auto-close="false"
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
      <!--
        폰에서 목록을 닫는 버튼. X 대신 PC 의 「접기」와 같은 « — 여는 버튼(»)과 짝이다 (2026-10-15 사용자 요청).
        테두리 없는 아이콘 버튼 — 테두리 있는 44px 칸은 폰에서 너무 크게 보였다.
      -->
      <UButton
        icon="i-lucide-chevrons-left"
        color="neutral"
        variant="ghost"
        class="size-10 shrink-0 justify-center"
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
      <UTooltip text="최근 메모·즐겨찾기 (⌘K / Ctrl+K)">
        <UButton
          type="button"
          icon="i-material-symbols-manage-search"
          color="neutral"
          variant="outline"
          class="size-9 shrink-0 justify-center"
          aria-label="최근 메모·즐겨찾기 빠르게 열기"
          data-testid="sidebar-quick-switch"
          @click="quickSwitch?.show()"
        />
      </UTooltip>
    </form>

    <p role="status" class="h-4 shrink-0 px-1 text-xs text-muted" data-testid="sidebar-navigation-pending">{{ mobileMenu.pending.value ? '화면을 여는 중…' : '' }}</p>

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
      <div v-if="treeError" class="space-y-2 px-1">
        <p class="text-sm text-error">{{ treeError }}</p>
        <UButton color="neutral" variant="outline" size="sm" @click="refresh">다시 시도</UButton>
      </div>
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
              :class="[item.kind === 'folder' && dnd.over.value === item.path && 'bg-primary/10 ring-1 ring-primary', slotClass(item)]"
              :draggable="!coarsePointer"
              :data-testid="item.kind === 'folder' ? 'sidebar-folder-row' : 'sidebar-memo-row'"
              @pointerdown="pressedMenuRow = null"
              @click.capture="suppressPressClick($event, item)"
              @dragstart="dnd.start($event, dragged(item))"
              @dragend="dnd.end"
              @dragenter="dnd.overRow($event, rowTarget(item))"
              @dragover="dnd.overRow($event, rowTarget(item))"
              @dragleave="dnd.leaveRow(rowTarget(item))"
              @drop="dnd.dropRow($event, rowTarget(item))"
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
              <!-- 외부 공개 중인 메모 — 무엇이 열려 있는지 트리에서 바로 보이게 -->
              <UIcon v-if="item.public" name="i-material-symbols-public" class="size-4 shrink-0 text-primary" aria-label="외부 공개 중" data-testid="sidebar-memo-public" />
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
                  variant="ghost"
                  size="xs"
                  class="size-9 justify-center lg:size-6"
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
        <!-- 아이콘 한 줄 — 할 일·캘린더·태그 + ⋯(휴지통·AI 연결·로그아웃). 이름은 PC 툴팁과 aria-label -->
        <nav class="flex items-center justify-around" aria-label="메모 탐색" data-testid="sidebar-navigation">
          <UTooltip v-for="link in links" :key="link.testId" :text="link.label">
            <UButton
              :to="link.to"
              color="neutral"
              variant="ghost"
              active-color="primary"
              active-variant="soft"
              class="size-11 justify-center lg:size-9"
              :aria-label="link.label"
              :data-testid="link.testId"
            >
              <!--
                뱃지는 빨강 하나로 통일, 숫자는 흰 글씨 (기본은 text-inverted 라 다크에서 검정이 된다).
                숫자 뱃지는 기본 크기(10px)가 폰에서 안 읽혀 키운다. 점은 그대로
              -->
              <UChip
                :show="!!link.chip"
                :text="link.chip?.text"
                color="error"
                size="lg"
                :ui="link.chip?.text ? { base: 'h-4 min-w-4 px-1 text-[10px] leading-none text-white' } : undefined"
              >
                <UIcon :name="link.icon" class="size-6 lg:size-5" />
              </UChip>
            </UButton>
          </UTooltip>
          <UDropdownMenu :items="moreMenu" :content="{ align: 'end', side: 'top' }" :ui="{ item: 'min-h-11 lg:min-h-0' }">
            <UButton
              icon="i-material-symbols-more-horiz"
              color="neutral"
              :variant="moreActive ? 'soft' : 'ghost'"
              :class="['size-11 justify-center lg:size-9', moreActive && 'text-primary']"
              :ui="{ leadingIcon: 'size-6 lg:size-5' }"
              aria-label="더 보기"
              data-testid="sidebar-more-menu"
            />
            <template #item-label="{ item: menuItem }">
              <span :data-testid="menuItem.testId">{{ menuItem.label }}</span>
            </template>
          </UDropdownMenu>
        </nav>
      </div>
    </template>
  </UDashboardSidebar>

  <MemoQuickSwitch ref="quickSwitch" />
  <MemoTemplatesDialog ref="templatesDialog" />

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
