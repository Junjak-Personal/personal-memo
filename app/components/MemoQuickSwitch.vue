<script setup lang="ts">
import type { MemoMeta, SearchHit } from '#shared/types/memo'
import { isNavigationFailure } from 'vue-router'
import { screenScope } from '~/utils/last-screen'
import { createMemoQuickSearch, quickSelection, quickSwitchKey, type MemoQuickSearchState } from '~/utils/memo-navigation'

interface Row { memo: MemoMeta; group: string; snippet?: string }

const navigation = useMemoNavigation()
const { refresh: refreshTree, error: treeError } = useMemoTree()
const { session } = useUserSession()
const route = useRoute()
const visible = ref(false)
const query = ref('')
const selected = ref(0)
const opening = ref(false)
const openError = ref<string | null>(null)
const searchState = ref<MemoQuickSearchState>({ results: [], loading: false, error: null })
const input = useTemplateRef<{ inputRef?: HTMLInputElement }>('input')
const listId = useId()
let timer: ReturnType<typeof setTimeout> | null = null
let composing = false

const search = createMemoQuickSearch({
  scope: () => screenScope(session.value),
  active: () => visible.value,
  fetch: (q, signal) => $fetch<SearchHit[]>('/api/search', { query: { q }, signal }),
  setState: (state) => { searchState.value = state; selected.value = 0 },
  message: (error) => apiMessage(error, '검색하지 못했습니다'),
})
const rows = computed<Row[]>(() => {
  if (query.value.trim()) return searchState.value.results.map((memo) => ({ memo, group: '검색 결과', snippet: memo.snippet }))
  const favoriteIds = new Set(navigation.favorites.value.map((memo) => memo.id))
  return [
    ...navigation.favorites.value.map((memo) => ({ memo, group: '즐겨찾기' })),
    ...navigation.recent.value.filter((memo) => !favoriteIds.has(memo.id)).map((memo) => ({ memo, group: '최근 메모' })),
  ]
})
const loading = computed(() => searchState.value.loading || (!query.value.trim() && navigation.pending.value))
const error = computed(() => openError.value ?? searchState.value.error ?? navigation.error.value ?? treeError.value)

function resetSearch() {
  if (timer) clearTimeout(timer)
  timer = null
  search.reset()
}

function close() {
  visible.value = false
  query.value = ''
  openError.value = null
  composing = false
  resetSearch()
}

function show() {
  if (!screenScope(session.value)) return
  query.value = ''
  selected.value = 0
  openError.value = null
  resetSearch()
  visible.value = true
  // 다른 기기에서 바꾼 별표·제목도 창을 다시 열 때 반영한다. 기존 목록은 응답 전까지 보여 준다.
  void Promise.all([refreshTree(), navigation.refresh()]).catch(() => {})
  void nextTick(() => input.value?.inputRef?.focus())
}

function onInput(value: string | number) {
  query.value = String(value)
  openError.value = null
  resetSearch()
  selected.value = 0
  if (!composing && query.value.trim()) {
    searchState.value = { results: [], loading: true, error: null }
    timer = setTimeout(() => { timer = null; void search.search(query.value) }, 200)
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || composing || opening.value) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    selected.value = quickSelection(event.key, selected.value, rows.value.length)
    void nextTick(() => document.getElementById(`${listId}-${selected.value}`)?.scrollIntoView({ block: 'nearest' }))
  } else if (event.key === 'Enter') {
    event.preventDefault()
    selected.value = quickSelection('', selected.value, rows.value.length)
    const row = rows.value[selected.value]
    if (row) void openMemo(row.memo)
  }
}

function onShortcut(event: KeyboardEvent) {
  if (!quickSwitchKey(event) || !screenScope(session.value)) return
  // 에디터의 링크 단축키보다 먼저 받는다. 일반 K·한글 조합 입력은 가로채지 않는다.
  event.preventDefault()
  event.stopImmediatePropagation()
  if (visible.value) close()
  else show()
}

async function openMemo(memo: MemoMeta) {
  if (opening.value) return
  const scope = screenScope(session.value)
  if (!scope) return
  opening.value = true
  openError.value = null
  const path = memoPath(memo.id)
  try {
    // 기존 route guard가 현재 입력을 먼저 저장한다. 막힌 이동이면 이 창에서 다시 고를 수 있다.
    const failure = await navigateTo(path)
    if (scope !== screenScope(session.value)) return
    if (route.path === path) close()
    else if (failure === false || isNavigationFailure(failure)) openError.value = '메모 이동이 취소됐습니다. 현재 메모의 저장 상태를 확인하세요.'
  } catch (cause) {
    if (scope === screenScope(session.value)) openError.value = apiMessage(cause, '메모를 열지 못했습니다')
  } finally { opening.value = false }
}

function retry() {
  openError.value = null
  resetSearch()
  if (query.value.trim()) void search.search(query.value)
  else void Promise.all([refreshTree(), navigation.refresh()]).catch(() => {})
}

onMounted(() => window.addEventListener('keydown', onShortcut, { capture: true }))
onBeforeUnmount(() => { window.removeEventListener('keydown', onShortcut, { capture: true }); resetSearch() })
// 로그인 변경은 외부 이벤트다. 이전 검색 본문과 메모 선택을 즉시 없앤다.
watch(() => screenScope(session.value), () => close(), { flush: 'sync' })
defineExpose({ show })
</script>

<template>
  <UModal
    :open="visible"
    title="메모 빠르게 열기"
    description="즐겨찾기·최근 메모 또는 제목·본문·#태그로 찾으세요."
    :ui="{ content: 'sm:max-w-xl', body: 'p-3 sm:p-4' }"
    @update:open="value => value ? show() : close()"
  >
    <template #body>
      <div class="space-y-3" data-testid="memo-quick-switch">
        <UInput
          ref="input"
          :model-value="query"
          autofocus
          icon="i-material-symbols-search"
          placeholder="제목·본문·#태그 검색"
          class="w-full"
          autocomplete="off"
          role="combobox"
          :aria-expanded="visible"
          :aria-controls="listId"
          :aria-activedescendant="rows[selected] ? `${listId}-${selected}` : undefined"
          aria-label="메모 검색"
          data-testid="memo-quick-search"
          @update:model-value="onInput"
          @keydown="onKeydown"
          @compositionstart="composing = true; resetSearch()"
          @compositionend="composing = false; onInput(query)"
        />
        <UAlert v-if="error" color="error" variant="subtle" :title="error" :actions="[{ label: '다시 시도', color: 'neutral', variant: 'outline', onClick: retry }]" />
        <p v-if="loading" role="status" class="px-2 text-sm text-muted">불러오는 중…</p>
        <div :id="listId" role="listbox" aria-label="메모 목록" class="max-h-[50dvh] overflow-y-auto sm:max-h-96" :aria-busy="loading">
          <template v-for="(row, index) in rows" :key="row.memo.id">
            <p v-if="index === 0 || rows[index - 1]?.group !== row.group" class="px-2 pt-3 pb-1 text-xs font-medium text-muted">{{ row.group }}</p>
            <div class="flex min-w-0 items-center gap-1 rounded-md" :class="selected === index && 'bg-elevated'" role="presentation" @pointermove="selected = index">
              <button
                :id="`${listId}-${index}`"
                type="button"
                role="option"
                :aria-selected="selected === index"
                :disabled="opening"
                class="min-h-11 min-w-0 flex-1 rounded-md px-2 py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-primary"
                data-testid="memo-quick-result"
                @click="openMemo(row.memo)"
              >
                <span class="block truncate text-sm font-medium">{{ row.memo.title || '제목 없음' }}</span>
                <span v-if="row.snippet" class="block truncate text-xs text-muted">{{ row.snippet }}</span>
                <span class="block truncate text-xs text-dimmed">{{ row.memo.folder || '최상위' }}</span>
              </button>
              <UButton
                :icon="navigation.isFavorite(row.memo.id) ? 'i-material-symbols-star' : 'i-material-symbols-star-outline'"
                :color="navigation.isFavorite(row.memo.id) ? 'primary' : 'neutral'"
                variant="ghost"
                class="size-11 shrink-0 justify-center"
                :disabled="navigation.pending.value"
                :aria-label="navigation.isFavorite(row.memo.id) ? '즐겨찾기 해제' : '즐겨찾기에 추가'"
                :aria-pressed="navigation.isFavorite(row.memo.id)"
                data-testid="memo-quick-favorite"
                @click="navigation.toggleFavorite(row.memo.id)"
              />
            </div>
          </template>
        </div>
        <p v-if="!loading && !error && !rows.length" class="py-6 text-center text-sm text-muted">
          {{ query.trim() ? '찾은 메모가 없습니다' : '메모를 열거나 즐겨찾기에 추가하면 여기에 표시됩니다' }}
        </p>
        <p class="px-2 text-xs text-dimmed">↑↓ 선택 · Enter 열기 · Esc 닫기</p>
      </div>
    </template>
  </UModal>
</template>
