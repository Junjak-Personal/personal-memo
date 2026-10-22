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
const refreshing = ref(false)
let refreshSequence = 0
const searchState = shallowRef<MemoQuickSearchState>({ results: [], loading: false, error: null, resultsQuery: null })
const input = useTemplateRef<{ inputRef?: HTMLInputElement }>('input')
const listId = useId()
let timer: ReturnType<typeof setTimeout> | null = null
let composing = false

const search = createMemoQuickSearch({
  scope: () => screenScope(session.value),
  active: () => visible.value,
  fetch: (q, signal) => $fetch<SearchHit[]>('/api/search', { query: { q }, signal }),
  setState: (state) => { if (state.results !== searchState.value.results) selected.value = 0; searchState.value = state },
  message: (error) => apiMessage(error, '검색하지 못했습니다'),
})
const rows = computed<Row[]>(() => {
  if (query.value.trim() && searchState.value.resultsQuery !== null) return searchState.value.results.map((memo) => ({ memo, group: '검색 결과', snippet: memo.snippet }))
  const favoriteIds = new Set(navigation.favorites.value.map((memo) => memo.id))
  return [
    ...navigation.favorites.value.map((memo) => ({ memo, group: '즐겨찾기' })),
    ...navigation.recent.value.filter((memo) => !favoriteIds.has(memo.id)).map((memo) => ({ memo, group: '최근 메모' })),
  ]
})
const loading = computed(() => searchState.value.loading || refreshing.value || (!query.value.trim() && navigation.pending.value))
const error = computed(() => openError.value ?? searchState.value.error ?? navigation.error.value ?? treeError.value)

function resetSearch() {
  if (timer) clearTimeout(timer)
  timer = null
  search.reset()
}

function close() {
  refreshSequence++
  refreshing.value = false
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
  void refreshNavigation()
  void nextTick(() => input.value?.inputRef?.focus())
}

function cancelDebounce() {
  if (timer) clearTimeout(timer)
  timer = null
  search.cancel()
}

function onInput(value: string | number) {
  query.value = String(value)
  openError.value = null
  cancelDebounce()
  selected.value = 0
  if (!query.value.trim()) { search.reset(); return }
  if (!composing) {
    search.prepare(query.value)
    timer = setTimeout(() => { timer = null; void search.search(query.value) }, 200)
  }
}

async function refreshNavigation() {
  const token = ++refreshSequence
  const scope = screenScope(session.value)
  refreshing.value = true
  try { await Promise.all([refreshTree(), navigation.refresh()]) } catch { /* 기존 error 상태와 재시도를 사용한다. */ }
  finally { if (token === refreshSequence && scope === screenScope(session.value) && visible.value) refreshing.value = false }
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
  cancelDebounce()
  if (query.value.trim()) void search.search(query.value)
  else void refreshNavigation()
}

onMounted(() => window.addEventListener('keydown', onShortcut, { capture: true }))
onBeforeUnmount(() => { window.removeEventListener('keydown', onShortcut, { capture: true }); close() })
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
          :loading="loading || opening"
          :aria-busy="loading || opening"
          :ui="{ leadingIcon: 'motion-reduce:animate-none' }"
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
          @compositionstart="composing = true; cancelDebounce()"
          @compositionend="composing = false; onInput(query)"
        />
        <MemoLoadingRegion
          :loading="loading || opening"
          :label="opening ? '메모를 여는 중' : '메모 목록을 불러오는 중'"
          :overlay="false"
          :preserve-height="false"
          class="h-[min(20rem,45dvh)] sm:h-[min(24rem,50dvh)]"
          data-testid="memo-quick-viewport"
        >
          <div class="flex h-full min-h-0 flex-col gap-2">
            <UAlert v-if="error" color="error" variant="subtle" :title="error" class="shrink-0" :actions="[{ label: '다시 시도', color: 'neutral', variant: 'outline', onClick: retry }]" />
            <div :id="listId" role="listbox" aria-label="메모 목록" class="min-h-0 flex-1 overflow-y-auto" :aria-busy="loading || opening">
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
              <p v-if="!loading && !error && !rows.length" class="flex h-full min-h-11 items-center justify-center px-2 text-center text-sm text-muted" data-testid="memo-quick-empty">
                {{ query.trim() ? '찾은 메모가 없습니다' : '메모를 열거나 즐겨찾기에 추가하면 여기에 표시됩니다' }}
              </p>
            </div>
          </div>
        </MemoLoadingRegion>
        <p class="px-2 text-xs text-dimmed">↑↓ 선택 · Enter 열기 · Esc 닫기</p>
      </div>
    </template>
  </UModal>
</template>
