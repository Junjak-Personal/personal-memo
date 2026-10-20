<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { MemoMeta } from '#shared/types/memo'
import { screenScope } from '~/utils/last-screen'
import { insertMemoReferenceSafely, memoReferenceQuery } from '~/utils/memo-reference'
import type { MemoReferenceQuery } from '~/utils/memo-reference'

const props = defineProps<{
  editor: Editor
  flush: () => Promise<boolean>
  folder: () => string
  memoId?: () => string
  disabled?: boolean
}>()
const { session } = useUserSession()
const { tree, refresh } = useMemoTree()
const toast = useToast()
const query = shallowRef<MemoReferenceQuery | null>(null)
const selected = ref(0)
const pending = ref(false)
const error = ref('')
const listId = useId()
let dismissed = ''
let operation = 0
let alive = true
let composing = false

function key(value: MemoReferenceQuery | null) {
  return value ? `${value.from}:${value.to}:${value.query}` : ''
}
const normalized = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR').trim()
const available = computed(() => tree.value?.memos.filter(memo => !memo.unreadable) ?? [])
const matches = computed(() => {
  const text = normalized(query.value?.query ?? '')
  return available.value.filter(memo => !text || normalized(memo.title).includes(text))
    .sort((a, b) => a.title.localeCompare(b.title, 'ko') || a.folder.localeCompare(b.folder, 'ko')).slice(0, 10)
})
const canCreate = computed(() => {
  const text = normalized(query.value?.query ?? '')
  return !!text && !available.value.some(memo => normalized(memo.title) === text)
})
const count = computed(() => matches.value.length + (canCreate.value ? 1 : 0))
const open = computed(() => !!query.value && key(query.value) !== dismissed && !props.disabled && !!screenScope(session.value))
const reference = computed(() => {
  const pos = query.value?.to
  if (pos === undefined || props.editor.isDestroyed) return undefined
  return {
    contextElement: props.editor.view.dom,
    getBoundingClientRect: () => {
      try {
        const box = props.editor.view.coordsAtPos(pos)
        return new DOMRect(box.left, box.top, Math.max(1, box.right - box.left), Math.max(1, box.bottom - box.top))
      } catch { return props.editor.view.dom.getBoundingClientRect() }
    },
  }
})

function sync() {
  const next = !composing && !props.disabled && props.editor.isEditable && !props.editor.isDestroyed ? memoReferenceQuery(props.editor.state) : null
  if (key(next) !== key(query.value)) {
    selected.value = 0
    error.value = ''
  }
  query.value = next
  if (!next) dismissed = ''
}
function dismiss() {
  dismissed = key(query.value)
  ++operation
  pending.value = false
  error.value = ''
}
function onCompositionStart() { composing = true; query.value = null }
function onCompositionEnd() { composing = false; void nextTick(sync) }

async function choose(target: MemoMeta | null) {
  if (!open.value || pending.value || !query.value || !screenScope(session.value)) return
  const title = query.value.query
  const sourceId = props.memoId?.()
  if (!target && !canCreate.value) return
  const token = ++operation
  const scope = screenScope(session.value)
  pending.value = true
  error.value = ''
  let prepared = false
  try {
    const result = await insertMemoReferenceSafely({
      alive: () => alive && token === operation && !props.editor.isDestroyed && !props.disabled && !composing && open.value,
      state: () => props.editor.state,
      scope: () => screenScope(session.value),
      flush: props.flush,
      prepare: async () => {
        let memo: MemoMeta
        if (!target) {
          memo = await $fetch<MemoMeta>('/api/memos', { method: 'POST', body: { folder: props.folder(), title, content: '', date: null, dateEnd: null, tags: [] } })
        } else if (target.id.startsWith('p:')) {
          // 자신을 연결할 때 flush가 먼저 영구 ID를 부여했을 수 있다.
          const resolvedId = sourceId === target.id ? props.memoId?.() ?? target.id : target.id
          memo = resolvedId.startsWith('p:')
            ? await $fetch<MemoMeta>(`/api/memos/${encodeURIComponent(resolvedId)}/link-target`, { method: 'POST' })
            : { ...target, id: resolvedId }
        } else memo = target
        prepared = true
        return memo
      },
      insert: tr => {
        props.editor.view.dispatch(tr)
        props.editor.commands.focus()
      },
    })
    if (!alive || token !== operation || screenScope(session.value) !== scope) return
    if (prepared) void refresh()
    if (result === 'inserted') query.value = null
    else if (result === 'save-failed') error.value = '현재 내용을 저장하지 못해 연결하지 않았습니다. 저장 상태를 확인하세요.'
    else {
      dismiss()
      toast.add({ color: 'warning', title: '입력이 바뀌어 링크를 넣지 않았습니다', description: prepared && !target ? '만든 메모는 목록에 있습니다. 다시 선택해 연결하세요.' : '다시 선택해 연결하세요.' })
    }
  } catch (cause) {
    if (alive && token === operation && screenScope(session.value) === scope) error.value = apiMessage(cause, '메모를 연결하지 못했습니다. 목록을 확인한 뒤 다시 선택하세요.')
  } finally {
    if (alive && token === operation) pending.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (!open.value || event.isComposing || props.editor.view.composing) return
  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.key === 'Escape') { dismiss(); return }
  if (pending.value) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!count.value) return
    selected.value = (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + count.value) % count.value
    void nextTick(() => document.getElementById(`${listId}-${selected.value}`)?.scrollIntoView({ block: 'nearest' }))
  } else {
    selected.value = Math.min(selected.value, count.value - 1)
    const target = matches.value[selected.value]
    if (target) void choose(target)
    else if (canCreate.value) void choose(null)
  }
}

onMounted(() => {
  sync()
  props.editor.on('transaction', sync)
  props.editor.on('update', sync)
  props.editor.view.dom.addEventListener('keydown', onKeydown, { capture: true })
  props.editor.view.dom.addEventListener('compositionstart', onCompositionStart)
  props.editor.view.dom.addEventListener('compositionend', onCompositionEnd)
})
onBeforeUnmount(() => {
  alive = false
  ++operation
  props.editor.off('transaction', sync)
  props.editor.off('update', sync)
  if (!props.editor.isDestroyed) {
    props.editor.view.dom.removeEventListener('keydown', onKeydown, { capture: true })
    props.editor.view.dom.removeEventListener('compositionstart', onCompositionStart)
    props.editor.view.dom.removeEventListener('compositionend', onCompositionEnd)
  }
})
// 인증/편집 모드는 외부 상태다. 이전 제안·진행 중 응답을 새 화면에 적용하지 않는다.
watch(() => screenScope(session.value), () => { ++operation; pending.value = false; query.value = null; dismissed = ''; error.value = '' }, { flush: 'sync' })
watch(() => props.disabled, sync, { flush: 'sync' })
</script>

<template>
  <UPopover
    :open="open"
    :reference="reference"
    :content="{ align: 'start', side: 'bottom', onOpenAutoFocus: event => event.preventDefault(), onCloseAutoFocus: event => event.preventDefault() }"
    @update:open="value => { if (!value) dismiss() }"
  >
    <template #content>
      <div class="w-80 max-w-[calc(100vw-2rem)] p-2" data-testid="memo-link-suggestions">
        <p class="px-2 py-1 text-xs font-medium text-muted">메모 연결</p>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-2" />
        <p v-if="pending" role="status" class="px-2 py-1 text-xs text-muted">저장하고 연결하는 중…</p>
        <div :id="listId" role="listbox" aria-label="연결할 메모" class="max-h-64 overflow-y-auto" :aria-busy="pending">
          <button
            v-for="(memo, index) in matches"
            :id="`${listId}-${index}`"
            :key="memo.id"
            type="button"
            role="option"
            :aria-selected="selected === index"
            :disabled="pending"
            class="block min-h-11 w-full rounded-md px-2 py-2 text-start hover:bg-elevated"
            :class="selected === index && 'bg-elevated'"
            data-testid="memo-link-target"
            @mousedown.prevent
            @pointermove="selected = index"
            @click="choose(memo)"
          >
            <span class="block truncate text-sm">{{ memo.title || '제목 없음' }}</span>
            <span class="block truncate text-xs text-muted">{{ memo.folder || '최상위' }}</span>
          </button>
          <button
            v-if="canCreate"
            :id="`${listId}-${matches.length}`"
            type="button"
            role="option"
            :aria-selected="selected === matches.length"
            :disabled="pending"
            class="block min-h-11 w-full rounded-md border border-default px-2 py-2 text-start text-sm hover:bg-elevated"
            :class="selected === matches.length && 'bg-elevated'"
            data-testid="memo-link-create"
            @mousedown.prevent
            @pointermove="selected = matches.length"
            @click="choose(null)"
          >「{{ query?.query }}」 만들고 연결</button>
        </div>
        <p v-if="!matches.length && !canCreate" class="px-2 py-3 text-sm text-muted">연결할 메모 이름을 입력하세요.</p>
        <p class="px-2 pt-2 text-xs text-dimmed">↑↓ 선택 · Enter 연결 · Esc 닫기</p>
      </div>
    </template>
  </UPopover>
</template>
