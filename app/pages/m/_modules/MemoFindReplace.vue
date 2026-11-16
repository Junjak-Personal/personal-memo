<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { memoFindKey, memoFindPlugin, replaceMemoMatches, searchMemoTransaction, selectMemoMatch } from '~/utils/editor-find'
import type { MemoFindState } from '~/utils/editor-find'

const props = defineProps<{ editor: Editor; disabled?: boolean }>()
const open = ref(false)
const searchInput = ref('')
const appliedQuery = ref('')
const caseSensitive = ref(false)
const composing = ref(false)
const replacement = ref('')
const result = shallowRef<MemoFindState>()
const error = ref('')
const notice = ref('')
const count = computed(() => result.value?.matches.length ?? 0)
const editable = computed(() => !props.disabled && props.editor.isEditable)
let registered = false

function sync() { result.value = memoFindKey.getState(props.editor.state) }
function select(index: number) {
  const tr = selectMemoMatch(props.editor.state, index)
  if (tr) props.editor.view.dispatch(tr)
}
function search() {
  if (props.disabled || props.editor.isDestroyed || composing.value) return
  appliedQuery.value = searchInput.value
  error.value = notice.value = ''
  props.editor.view.dispatch(searchMemoTransaction(props.editor.state, appliedQuery.value, caseSensitive.value))
  if (count.value) select(0)
}
function move(direction: number) {
  if (!count.value || props.editor.isDestroyed) return
  select(((result.value?.activeIndex ?? 0) + direction + count.value) % count.value)
}
function reset() {
  searchInput.value = appliedQuery.value = replacement.value = error.value = notice.value = ''
  composing.value = false
  if (!props.editor.isDestroyed) props.editor.view.dispatch(searchMemoTransaction(props.editor.state, '', false))
}
function replace(all: boolean) {
  if (!editable.value || props.editor.isDestroyed || !result.value || (all && result.value.limited)) return
  const matches = all ? result.value.matches : result.value.matches.slice(result.value.activeIndex, result.value.activeIndex + 1)
  const tr = replaceMemoMatches(props.editor.state, matches, replacement.value)
  if (!tr) { error.value = '선택한 검색 결과가 바뀌었습니다. 다시 검색하세요.'; return }
  const nextPosition = matches[0]!.from + replacement.value.length
  props.editor.view.dispatch(tr)
  error.value = ''
  notice.value = `${matches.length}개를 바꿨습니다.`
  if (count.value) {
    const next = result.value?.matches.findIndex(match => match.from >= nextPosition) ?? -1
    select(next < 0 ? 0 : next)
  }
}
function onSearchKey(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || composing.value) return
  event.preventDefault()
  if (searchInput.value !== appliedQuery.value || caseSensitive.value !== result.value?.caseSensitive || !appliedQuery.value) search()
  else move(event.shiftKey ? -1 : 1)
}
function onShortcut(event: KeyboardEvent) {
  if (props.disabled || props.editor.isDestroyed || !props.editor.view.hasFocus() || event.isComposing || props.editor.view.composing) return
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    open.value = true
  }
}
watch(open, value => { if (!value) reset() })
watch(() => props.disabled, disabled => { if (disabled) open.value = false })
onMounted(() => {
  if (!memoFindKey.getState(props.editor.state)) { props.editor.registerPlugin(memoFindPlugin()); registered = true }
  props.editor.on('transaction', sync)
  window.addEventListener('keydown', onShortcut, { capture: true })
  sync()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcut, { capture: true })
  props.editor.off('transaction', sync)
  if (!props.editor.isDestroyed && registered) props.editor.unregisterPlugin(memoFindKey)
})
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UTooltip text="문서에서 찾기·바꾸기">
      <UButton icon="i-material-symbols-find-replace" color="neutral" variant="ghost" class="size-11 shrink-0 justify-center lg:size-8" aria-label="문서에서 찾기·바꾸기" :disabled="disabled" data-testid="memo-find-open" />
    </UTooltip>
    <template #content>
      <div class="w-88 max-w-[calc(100vw-2rem)] space-y-3 p-3" data-testid="memo-find-panel">
        <h2 class="text-sm font-medium">문서에서 찾기·바꾸기</h2>
        <form class="flex gap-2" @submit.prevent="search">
          <UInput v-model="searchInput" aria-label="찾을 내용" placeholder="찾을 내용" autofocus :maxlength="1000" class="min-w-0 flex-1" data-testid="memo-find-query-input" @keydown="onSearchKey" @compositionstart="composing = true" @compositionend="composing = false" />
          <UButton type="submit" :disabled="!searchInput" data-testid="memo-find-search">찾기</UButton>
        </form>
        <div class="flex items-center justify-between gap-2">
          <UCheckbox v-model="caseSensitive" label="대소문자 구분" data-testid="memo-find-case-toggle" />
          <div class="flex gap-1">
            <UButton icon="i-material-symbols-arrow-upward" color="neutral" variant="outline" size="sm" aria-label="이전 검색 결과" :disabled="!count" data-testid="memo-find-previous" @click="move(-1)" />
            <UButton icon="i-material-symbols-arrow-downward" color="neutral" variant="outline" size="sm" aria-label="다음 검색 결과" :disabled="!count" data-testid="memo-find-next" @click="move(1)" />
            <UButton icon="i-material-symbols-close" color="neutral" variant="outline" size="sm" aria-label="검색 초기화" :disabled="!searchInput && !appliedQuery" data-testid="memo-find-reset" @click="reset" />
          </div>
        </div>
        <p v-if="appliedQuery" class="text-xs text-muted" role="status" data-testid="memo-find-count">{{ count ? `${(result?.activeIndex ?? 0) + 1} / ${count}${result?.limited ? '+' : ''}` : '검색 결과가 없습니다.' }}</p>
        <p v-else class="text-xs text-muted">내용을 입력하고 Enter 또는 「찾기」를 누르세요.</p>
        <p v-if="result?.limited" class="text-xs text-warning">결과가 많아 처음 2,000개를 표시합니다. 검색 범위를 좁히면 모두 바꿀 수 있습니다.</p>
        <div v-if="editable" class="space-y-2 border-t border-default pt-3">
          <UInput v-model="replacement" aria-label="바꿀 내용" placeholder="바꿀 내용 · 비우면 삭제" class="w-full" data-testid="memo-find-replacement-input" />
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" size="sm" :disabled="!count || result?.limited" data-testid="memo-find-replace-all" @click="replace(true)">모두 바꾸기</UButton>
            <UButton size="sm" :disabled="!count" data-testid="memo-find-replace-current" @click="replace(false)">현재 바꾸기</UButton>
          </div>
        </div>
        <p v-if="error" class="text-xs text-error" role="alert" data-testid="memo-find-error">{{ error }}</p>
        <p v-else-if="notice" class="text-xs text-muted" role="status">{{ notice }}</p>
      </div>
    </template>
  </UPopover>
</template>
