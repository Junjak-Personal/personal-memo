<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import { TextSelection } from '@tiptap/pm/state'
import { memoOutlineKey, memoOutlineTransaction } from '~/utils/memo-outline'
import type { MemoOutlineEntry } from '~/utils/memo-outline'

const props = defineProps<{ editor: Editor; disabled?: boolean }>()
const open = ref(false)
const entries = shallowRef<MemoOutlineEntry[]>([])
const collapsed = shallowRef<ReadonlySet<number>>(new Set())

function sync() {
  const state = memoOutlineKey.getState(props.editor.state)
  entries.value = state?.entries ?? []
  collapsed.value = state?.collapsed ?? new Set()
}

function toggle(entry: MemoOutlineEntry) {
  if (props.disabled || props.editor.isDestroyed) return
  props.editor.view.dispatch(memoOutlineTransaction(props.editor.state, { type: 'toggle', pos: entry.pos }))
}

function jump(entry: MemoOutlineEntry) {
  if (props.editor.isDestroyed) return
  const state = props.editor.state
  const heading = state.doc.nodeAt(entry.pos)
  if (heading?.type.name !== 'heading') return
  const tr = memoOutlineTransaction(state, { type: 'reveal', pos: entry.pos })
  tr.setSelection(TextSelection.near(state.doc.resolve(entry.pos + 1)))
  props.editor.view.dispatch(tr)
  open.value = false
  // focus()를 하지 않아 목차 이동만으로 모바일 키보드가 튀어나오지 않는다.
  void nextTick(() => {
    const node = props.editor.view.nodeDOM(entry.pos)
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'start', behavior: 'auto' })
  })
}

function expandAll() {
  if (!props.editor.isDestroyed) props.editor.view.dispatch(memoOutlineTransaction(props.editor.state, { type: 'expandAll' }))
}

function onFind(event: KeyboardEvent) {
  // 목차 버튼/팝오버에 포커스가 있어도 브라우저 찾기가 숨은 본문을 찾을 수 있게 한다.
  if (!event.isComposing && !event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && collapsed.value.size) expandAll()
}

// 블록 이동은 외부 모드 변경이다. 접힌 문서를 끄는 동안 숨은 블록이 남지 않게 한다.
watch(() => props.disabled, (disabled) => {
  if (!props.editor.isDestroyed) props.editor.view.dispatch(memoOutlineTransaction(props.editor.state, { type: 'disabled', value: !!disabled }))
  if (disabled) open.value = false
}, { immediate: true, flush: 'sync' })

onMounted(() => { sync(); props.editor.on('transaction', sync); window.addEventListener('keydown', onFind, { capture: true }) })
onBeforeUnmount(() => { props.editor.off('transaction', sync); window.removeEventListener('keydown', onFind, { capture: true }) })
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UTooltip text="목차·접기">
      <UButton
        icon="i-material-symbols-format-list-bulleted"
        color="neutral"
        variant="ghost"
        aria-label="목차·접기"
        :disabled="disabled || !entries.length"
        data-testid="memo-outline-button"
      />
    </UTooltip>
    <template #content>
      <div class="w-80 max-w-[calc(100vw-2rem)] p-2" data-testid="memo-outline">
        <div class="flex items-center justify-between gap-2 border-b border-default px-2 pb-2">
          <h2 class="text-sm font-medium">목차·접기</h2>
          <UButton color="neutral" variant="outline" size="xs" :disabled="!collapsed.size" @click="expandAll">모두 펼치기</UButton>
        </div>
        <nav aria-label="문서 목차" class="max-h-[50dvh] overflow-y-auto py-1">
          <div v-for="entry in entries" :key="entry.pos" class="flex items-center gap-1" :style="{ paddingInlineStart: `${Math.min(entry.level - 1, 5) * 12}px` }">
            <UButton
              :icon="collapsed.has(entry.pos) ? 'i-material-symbols-chevron-right' : 'i-material-symbols-expand-more'"
              color="neutral"
              variant="ghost"
              class="size-11 shrink-0 justify-center sm:size-8"
              :disabled="disabled || entry.from === entry.to"
              :aria-label="`${entry.title} ${collapsed.has(entry.pos) ? '펼치기' : '접기'}`"
              :aria-expanded="!collapsed.has(entry.pos)"
              data-testid="memo-outline-fold"
              @click="toggle(entry)"
            />
            <UButton
              color="neutral"
              variant="ghost"
              class="min-h-11 min-w-0 flex-1 justify-start sm:min-h-8"
              :aria-label="`${entry.title} 위치로 이동`"
              data-testid="memo-outline-jump"
              @click="jump(entry)"
            >
              <span class="truncate">{{ entry.title }}</span>
            </UButton>
          </div>
        </nav>
      </div>
    </template>
  </UPopover>
</template>
