<script setup lang="ts">
import { closeHistory } from '@tiptap/pm/history'
import type { Editor } from '@tiptap/vue-3'
import { blockEdgeScrollDelta, blockInsertionIndex, getTopLevelBlocks, moveBlockTransaction } from './block-move'
import type { TopLevelBlock } from './block-move'

const props = defineProps<{ editor: Editor; disabled?: boolean }>()
const active = defineModel<boolean>('active', { default: false })
const toast = useToast()

interface BlockRow extends TopLevelBlock { top: number; bottom: number; left: number; right: number; handleTop: number }
interface PointerDrag {
  id: number; from: number; startX: number; startY: number; x: number; y: number; moving: boolean
  target: HTMLElement; doc: Editor['state']['doc']
}
const rows = shallowRef<BlockRow[]>([])
const viewport = ref({ top: 0, bottom: 0, right: 0 })
const drag = shallowRef<PointerDrag | null>(null)
const insertion = ref<number | null>(null)
const menuIndex = ref<number | null>(null)
const announcement = ref('')
const revision = ref(0)
const menuOpen = computed({ get: () => menuIndex.value !== null, set: (open: boolean) => { if (!open) menuIndex.value = null } })
const menuBlock = computed(() => rows.value.find(row => row.index === menuIndex.value))
const canUndo = computed(() => { void revision.value; return props.editor.can().undo() })
const canRedo = computed(() => { void revision.value; return props.editor.can().redo() })
const shownRows = computed(() => rows.value.filter(row => row.index === drag.value?.from || (row.bottom > viewport.value.top && row.top < viewport.value.bottom - 44)))
const lineY = computed(() => {
  if (!drag.value?.moving || insertion.value === null || !rows.value.length || insertion.value > rows.value.length) return null
  const y = insertion.value === rows.value.length ? rows.value.at(-1)!.bottom + 4 : rows.value[insertion.value]!.top - 4
  return y >= viewport.value.top && y <= viewport.value.bottom ? y : null
})

let panel: HTMLElement | null = null
let observer: ResizeObserver | null = null
let frame = 0
let scrollFrame = 0
let previousPadding = ''
let previouslyEditable = true
let wideScreen: MediaQueryList | null = null
let menuDoc: Editor['state']['doc'] | null = null
let applyingMove = false

function measure() {
  if (!active.value || props.editor.isDestroyed) return
  const bounds = panel?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight, right: window.innerWidth }
  const visual = window.visualViewport
  viewport.value = {
    top: Math.max(bounds.top, visual?.offsetTop ?? 0),
    bottom: Math.min(bounds.bottom, window.innerHeight, visual ? visual.offsetTop + visual.height : window.innerHeight),
    right: Math.min(bounds.right, window.innerWidth),
  }
  rows.value = getTopLevelBlocks(props.editor.state.doc).flatMap(block => {
    const node = props.editor.view.nodeDOM(block.pos)
    if (!(node instanceof HTMLElement)) return []
    const rect = node.getBoundingClientRect()
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight) || 28
    const handleTop = rect.top + (Math.min(rect.height, lineHeight) - 44) / 2
    return [{ ...block, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, handleTop }]
  })
  if (rows.value.length !== props.editor.state.doc.childCount) {
    cancelDrag()
    menuIndex.value = null
    rows.value = []
    return
  }
  if (drag.value?.moving) insertion.value = blockInsertionIndex(drag.value.y, rows.value)
}

function queueMeasure() {
  if (!active.value || frame) return
  frame = requestAnimationFrame(() => { frame = 0; measure() })
}

function enter() {
  if (props.disabled || props.editor.isDestroyed || active.value) return
  previouslyEditable = props.editor.isEditable
  props.editor.commands.blur()
  props.editor.commands.setMeta('hideDragHandle', true)
  props.editor.setEditable(false, false)
  const dom = props.editor.view.dom
  previousPadding = dom.style.paddingRight
  // 본문과 분리된 전용 터치 영역. 평소 편집 레이아웃과 텍스트 선택에는 영향을 주지 않는다.
  dom.style.paddingRight = '52px'
  dom.classList.add('mobile-block-move-active')
  dom.addEventListener('click', preventEditorAction, true)
  active.value = true
  panel = dom.closest<HTMLElement>('[data-slot="body"]')
  document.addEventListener('scroll', queueMeasure, true)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', queueMeasure)
  window.visualViewport?.addEventListener('resize', queueMeasure)
  window.visualViewport?.addEventListener('scroll', queueMeasure)
  observer = new ResizeObserver(queueMeasure)
  observer.observe(dom)
  void nextTick(queueMeasure)
}

function preventEditorAction(event: Event) {
  // 읽기 전용 contenteditable 안에서도 체크박스·이미지 링크는 별도로 동작할 수 있다.
  event.preventDefault()
  event.stopImmediatePropagation()
}

function finish() {
  cancelDrag()
  menuIndex.value = null
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  observer?.disconnect()
  observer = null
  document.removeEventListener('scroll', queueMeasure, true)
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('resize', queueMeasure)
  window.visualViewport?.removeEventListener('resize', queueMeasure)
  window.visualViewport?.removeEventListener('scroll', queueMeasure)
  if (active.value && !props.editor.isDestroyed) {
    const dom = props.editor.view.dom
    dom.style.paddingRight = previousPadding
    dom.classList.remove('mobile-block-move-active')
    dom.removeEventListener('click', preventEditorAction, true)
    props.editor.setEditable(previouslyEditable && !props.disabled, false)
  }
  active.value = false
  rows.value = []
  panel = null
}

function onVisibility() { if (document.visibilityState === 'hidden') cancelDrag() }
function onWideScreen(event: MediaQueryListEvent) { if (event.matches) finish() }
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !active.value || menuOpen.value) return
  if (drag.value) cancelDrag()
  else finish()
}

function onTransaction() {
  revision.value++
  if (!active.value) return
  if (drag.value && drag.value.doc !== props.editor.state.doc) {
    cancelDrag()
    announcement.value = '내용이 바뀌어 드래그를 취소했습니다. 다시 손잡이를 선택하세요.'
  }
  if (menuOpen.value && menuDoc !== props.editor.state.doc && !applyingMove) menuIndex.value = null
  queueMeasure()
}

function startPointer(event: PointerEvent, row: BlockRow) {
  if (!active.value || props.disabled || drag.value || rows.value.length !== props.editor.state.doc.childCount || !event.isPrimary || event.button !== 0) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  menuIndex.value = null
  drag.value = { id: event.pointerId, from: row.index, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moving: false, target, doc: props.editor.state.doc }
  try { target.setPointerCapture(event.pointerId) }
  catch { cancelDrag(); return }
  window.addEventListener('pointermove', movePointer, { passive: false })
  window.addEventListener('pointerup', endPointer)
  window.addEventListener('pointercancel', cancelPointer)
  target.addEventListener('lostpointercapture', cancelPointer)
}

function movePointer(event: PointerEvent) {
  const current = drag.value
  if (!current || current.id !== event.pointerId) return
  event.preventDefault()
  const moving = current.moving || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) >= 6
  drag.value = { ...current, x: event.clientX, y: event.clientY, moving }
  if (!moving) return
  insertion.value = blockInsertionIndex(event.clientY, rows.value)
  if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll)
}

function autoScroll() {
  scrollFrame = 0
  if (!drag.value?.moving || !panel) return
  const delta = blockEdgeScrollDelta(drag.value.y, viewport.value)
  if (delta) { panel.scrollBy({ top: delta, behavior: 'instant' }); measure() }
  scrollFrame = requestAnimationFrame(autoScroll)
}

function endPointer(event: PointerEvent) {
  const current = drag.value
  if (!current || current.id !== event.pointerId) return
  if (current.moving) {
    measure()
    const boundary = insertion.value
    const unchanged = current.doc === props.editor.state.doc
    cancelDrag()
    if (unchanged && boundary !== null) move(current.from, boundary)
  } else {
    cancelDrag()
    openMenu(current.from)
  }
}

function cancelPointer(event: PointerEvent) {
  if (drag.value?.id === event.pointerId) cancelDrag()
}

function cancelDrag() {
  const current = drag.value
  drag.value = null
  insertion.value = null
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  scrollFrame = 0
  window.removeEventListener('pointermove', movePointer)
  window.removeEventListener('pointerup', endPointer)
  window.removeEventListener('pointercancel', cancelPointer)
  if (current) {
    current.target.removeEventListener('lostpointercapture', cancelPointer)
    if (current.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id)
  }
}

function openMenu(index: number) {
  if (!active.value || props.disabled || drag.value || !rows.value.some(row => row.index === index)) return
  menuDoc = props.editor.state.doc
  menuIndex.value = index
}

function onHandleClick(event: MouseEvent, row: BlockRow) {
  // 터치/마우스의 탭은 pointerup에서 처리한다. 드래그 뒤 합성 click이 메뉴를 다시 열면 안 된다.
  if (event.detail === 0) openMenu(row.index)
}

function move(from: number, boundary: number) {
  if (!active.value || props.disabled || props.editor.isDestroyed) return
  try {
    const tr = moveBlockTransaction(props.editor.state, from, boundary)
    if (!tr) return
    applyingMove = true
    props.editor.view.dispatch(tr)
    props.editor.view.dispatch(closeHistory(props.editor.state.tr).setMeta('addToHistory', false))
    menuDoc = props.editor.state.doc
    const destination = boundary > from ? boundary - 1 : boundary
    if (menuOpen.value) menuIndex.value = destination
    announcement.value = `${from + 1}번째 블록을 ${destination + 1}번째로 옮겼습니다.`
    void nextTick(queueMeasure)
  } catch {
    toast.add({ color: 'error', title: '블록을 옮기지 못했습니다. 다시 시도해 주세요.' })
  } finally { applyingMove = false }
}

function undo() { menuIndex.value = null; props.editor.commands.undo(); queueMeasure() }
function redo() { menuIndex.value = null; props.editor.commands.redo(); queueMeasure() }
function handleStyle(row: BlockRow) {
  const current = drag.value
  if (current?.moving && current.from === row.index) return { top: `${current.y - 22}px`, left: `${Math.min(Math.max(current.x - 22, 0), viewport.value.right - 44)}px` }
  return { top: `${Math.max(row.handleTop, viewport.value.top + 2)}px`, left: `${Math.min(row.right + 4, viewport.value.right - 48)}px` }
}

// 읽기 권한은 부모가 비동기로 바꿀 수 있어 활성 모드를 즉시 닫아야 한다.
watch(() => props.disabled, disabled => { if (disabled && active.value) finish() })
onMounted(() => {
  props.editor.on('transaction', onTransaction)
  wideScreen = window.matchMedia('(min-width: 1024px)')
  wideScreen.addEventListener('change', onWideScreen)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  finish()
  props.editor.off('transaction', onTransaction)
  wideScreen?.removeEventListener('change', onWideScreen)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div>
    <Teleport to="#app-header-actions" defer>
      <UButton
        v-if="!active && !disabled"
        icon="i-material-symbols-drag-indicator"
        color="neutral"
        variant="outline"
        class="min-h-11 lg:hidden"
        data-testid="memo-block-move-start"
        @click="enter"
      >블록 이동</UButton>
      <template v-if="active">
        <UButton icon="i-material-symbols-undo" color="neutral" variant="outline" class="size-11 justify-center" aria-label="실행 취소" :disabled="!canUndo || !!drag" data-testid="memo-block-move-undo" @click="undo" />
        <UButton icon="i-material-symbols-redo" color="neutral" variant="outline" class="size-11 justify-center" aria-label="다시 실행" :disabled="!canRedo || !!drag" data-testid="memo-block-move-redo" @click="redo" />
        <UButton class="min-h-11" data-testid="memo-block-move-done" @click="finish">완료</UButton>
      </template>
    </Teleport>
    <Teleport v-if="active" to="#app-header-secondary" defer>
      <p class="border-b border-default px-3 py-2 text-xs text-muted" data-testid="memo-block-move-hint">손잡이를 끌거나 눌러 옮기세요. 본문은 스크롤할 수 있습니다.</p>
    </Teleport>
    <Teleport v-if="active" to="body">
      <div class="pointer-events-none fixed inset-0 z-40" data-testid="memo-block-move-handles">
        <button
          v-for="row in shownRows"
          :key="row.index"
          type="button"
          class="pointer-events-auto fixed flex size-11 touch-none select-none items-center justify-center rounded-md border border-default bg-default text-muted shadow-sm"
          :class="drag?.moving && drag.from === row.index && 'border-primary bg-elevated text-primary shadow-lg'"
          :style="handleStyle(row)"
          :disabled="!!drag && drag.from !== row.index"
          :aria-label="`${row.index + 1}번째 ${row.label} · 끌어서 이동하거나 눌러 메뉴 열기`"
          aria-haspopup="dialog"
          :data-testid="`memo-block-move-handle-${row.index}`"
          @pointerdown="startPointer($event, row)"
          @click.prevent="onHandleClick($event, row)"
          @contextmenu.prevent
          @dragstart.prevent
        ><UIcon name="i-material-symbols-drag-indicator" class="size-6" /></button>
        <div
          v-if="lineY !== null"
          class="fixed right-3 h-1 rounded-full bg-primary"
          :style="{ top: `${lineY}px`, left: `${Math.max(rows[0]?.left ?? 16, 8)}px` }"
          data-testid="memo-block-move-insertion"
        />
      </div>
    </Teleport>
    <span role="status" aria-live="polite" class="sr-only">{{ announcement }}</span>
    <UModal v-model:open="menuOpen" title="블록 이동" :description="menuBlock?.label" :ui="{ footer: 'justify-end' }">
      <template #body>
        <div class="flex flex-col gap-3">
          <UButton icon="i-material-symbols-arrow-upward" color="neutral" variant="outline" class="min-h-11 justify-center" :disabled="menuIndex === null || menuIndex <= 0" data-testid="memo-block-move-up" @click="menuIndex !== null && move(menuIndex, menuIndex - 1)">위로 이동</UButton>
          <UButton icon="i-material-symbols-arrow-downward" color="neutral" variant="outline" class="min-h-11 justify-center" :disabled="menuIndex === null || menuIndex >= rows.length - 1" data-testid="memo-block-move-down" @click="menuIndex !== null && move(menuIndex, menuIndex + 2)">아래로 이동</UButton>
        </div>
      </template>
      <template #footer><UButton color="neutral" variant="outline" class="min-h-11" @click="menuIndex = null">닫기</UButton></template>
    </UModal>
  </div>
</template>

<style>
.mobile-block-move-active {
  user-select: none;
  -webkit-user-select: none;
}
</style>
