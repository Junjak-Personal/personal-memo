<script setup lang="ts">
import { closeHistory } from '@tiptap/pm/history'
import type { Editor } from '@tiptap/vue-3'
import { blockEdgeScrollDelta, blockInsertionIndex, getTopLevelBlocks, moveBlockTransaction } from './block-move'
import type { TopLevelBlock } from './block-move'

const props = defineProps<{ editor: Editor; disabled?: boolean }>()
const emit = defineEmits<{ addBlock: [pos: number] }>()
const active = defineModel<boolean>('active', { default: false })
const toast = useToast()
const { open: sidebarOpen } = useMobileMenuNavigation()

interface BlockRow extends TopLevelBlock { top: number; bottom: number; left: number; right: number; handleTop: number; contentLeft: number }
interface PointerDrag {
  id: number; from: number; startX: number; startY: number; x: number; y: number; moving: boolean
  target: HTMLElement; doc: Editor['state']['doc']
}
const rows = shallowRef<BlockRow[]>([])
const overlayTarget = shallowRef<HTMLElement | null>(null)
const origin = ref({ top: 0, left: 0, right: 0 })
const viewport = ref({ top: 0, bottom: 0, right: 0, height: 0 })
const drag = shallowRef<PointerDrag | null>(null)
const insertion = ref<number | null>(null)
const announcement = ref('')
const revision = ref(0)
const canUndo = computed(() => { void revision.value; return props.editor.can().undo() })
const canRedo = computed(() => { void revision.value; return props.editor.can().redo() })
const lineY = computed(() => {
  if (!drag.value?.moving || insertion.value === null || !rows.value.length || insertion.value > rows.value.length) return null
  const y = insertion.value === rows.value.length ? rows.value.at(-1)!.bottom + 4 : rows.value[insertion.value]!.top - 4
  return y >= viewport.value.top && y <= viewport.value.bottom ? y - origin.value.top : null
})

let panel: HTMLElement | null = null
let observer: ResizeObserver | null = null
let frame = 0
let scrollFrame = 0
let previousPadding = ''
let previouslyEditable = true
let wideScreen: MediaQueryList | null = null

function measure() {
  if (!active.value || props.editor.isDestroyed) return
  const anchor = overlayTarget.value?.getBoundingClientRect()
  if (!anchor) return
  origin.value = { top: anchor.top, left: anchor.left, right: anchor.right }
  const bounds = panel?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight, right: window.innerWidth }
  const visual = window.visualViewport
  viewport.value = {
    top: Math.max(bounds.top, visual?.offsetTop ?? 0),
    bottom: Math.min(bounds.bottom, window.innerHeight, visual ? visual.offsetTop + visual.height : window.innerHeight),
    right: Math.min(bounds.right, window.innerWidth),
    height: window.innerHeight,
  }
  rows.value = getTopLevelBlocks(props.editor.state.doc).flatMap(block => {
    const node = props.editor.view.nodeDOM(block.pos)
    if (!(node instanceof HTMLElement)) return []
    const rect = node.getBoundingClientRect()
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight) || 28
    const handleTop = rect.top - anchor.top + (Math.min(rect.height, lineHeight) - 44) / 2
    return [{ ...block, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, handleTop, contentLeft: rect.left - anchor.left }]
  })
  if (rows.value.length !== props.editor.state.doc.childCount) {
    cancelDrag()
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
  if (props.disabled || sidebarOpen.value || props.editor.isDestroyed || active.value) return
  const dom = props.editor.view.dom
  panel = dom.closest<HTMLElement>('[data-slot="body"]')
  const content = dom.parentElement
  if (!panel || !content) return
  // EditorContent의 relative 래퍼에 붙여 본문과 동일한 스크롤·좌표계를 사용한다.
  overlayTarget.value = content
  previouslyEditable = props.editor.isEditable
  props.editor.commands.blur()
  window.getSelection()?.removeAllRanges()
  props.editor.commands.setMeta('hideDragHandle', true)
  props.editor.setEditable(false, false)
  previousPadding = dom.style.paddingLeft
  // 본문과 분리된 전용 터치 영역. 평소 편집 레이아웃과 텍스트 선택에는 영향을 주지 않는다.
  // 기존 바깥 16px 여백도 활용해 44px 터치 영역 두 개를 확보한다.
  dom.style.paddingLeft = '72px'
  dom.classList.add('mobile-block-move-active')
  dom.addEventListener('click', preventEditorAction, true)
  active.value = true
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
    dom.style.paddingLeft = previousPadding
    dom.classList.remove('mobile-block-move-active')
    dom.removeEventListener('click', preventEditorAction, true)
    props.editor.setEditable(previouslyEditable && !props.disabled, false)
  }
  active.value = false
  rows.value = []
  panel = null
  overlayTarget.value = null
}

function onVisibility() { if (document.visibilityState === 'hidden') cancelDrag() }
function onWideScreen(event: MediaQueryListEvent) { if (event.matches) finish() }
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !active.value || sidebarOpen.value) return
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
  queueMeasure()
}

function startPointer(event: PointerEvent, row: BlockRow) {
  if (!active.value || sidebarOpen.value || props.disabled || drag.value || rows.value.length !== props.editor.state.doc.childCount || !event.isPrimary || event.button !== 0) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  event.preventDefault()
  measure()
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
  measure()
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

function move(from: number, boundary: number, focusHandle = false) {
  if (!active.value || sidebarOpen.value || drag.value || props.disabled || props.editor.isDestroyed) return
  try {
    const tr = moveBlockTransaction(props.editor.state, from, boundary)
    if (!tr) return
    props.editor.view.dispatch(tr)
    props.editor.view.dispatch(closeHistory(props.editor.state.tr).setMeta('addToHistory', false))
    const destination = boundary > from ? boundary - 1 : boundary
    announcement.value = `${from + 1}번째 블록을 ${destination + 1}번째로 옮겼습니다.`
    void nextTick(() => {
      measure()
      if (focusHandle) overlayTarget.value?.querySelector<HTMLElement>(`[data-testid="memo-block-move-handle-${destination}"]`)?.focus({ preventScroll: true })
    })
  } catch {
    toast.add({ color: 'error', title: '블록을 옮기지 못했습니다. 다시 시도해 주세요.' })
  }
}

function undo() { props.editor.commands.undo(); queueMeasure() }
function redo() { props.editor.commands.redo(); queueMeasure() }
function addBlock(row: BlockRow) {
  if (!active.value || sidebarOpen.value || props.disabled || drag.value || !previouslyEditable || props.editor.isDestroyed) return
  const current = getTopLevelBlocks(props.editor.state.doc)[row.index]
  if (!current || current.pos !== row.pos || current.nodeSize !== row.nodeSize) return
  // +는 PC와 같은 블록 메뉴로 연결한다. 편집을 복원한 다음 추가해야 키보드·메뉴가 정상 작동한다.
  finish()
  emit('addBlock', current.pos)
}
function handleStyle(row: BlockRow, kind: 'add' | 'drag' = 'drag') {
  const current = drag.value
  if (kind === 'drag' && current?.moving && current.from === row.index) return { top: `${current.y - origin.value.top - 22}px`, left: `${Math.min(Math.max(current.x - origin.value.left - 22, 0), origin.value.right - origin.value.left - 44)}px` }
  return { top: `${row.handleTop}px`, left: `${Math.max(row.contentLeft - (kind === 'add' ? 88 : 44), 0)}px` }
}

// 읽기 권한은 부모가 비동기로 바꿀 수 있어 활성 모드를 즉시 닫아야 한다.
watch(() => props.disabled, disabled => { if (disabled && active.value) finish() })
// 사이드바는 외부 컴포넌트가 연다. 그 뒤에서 capture된 포인터가 블록을 옮기지 않게 취소한다.
watch(sidebarOpen, open => { if (open) cancelDrag() }, { flush: 'sync' })
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
  <div class="contents">
    <UButton
      v-if="!active && !disabled"
      icon="i-material-symbols-drag-indicator"
      color="neutral"
      variant="ghost"
      class="size-11 justify-center lg:hidden"
      aria-label="블록 이동"
      data-testid="memo-block-move-start"
      @click="enter"
    />
    <template v-if="active">
      <UButton
        icon="i-material-symbols-undo"
        color="neutral"
        variant="ghost"
        class="size-11 justify-center"
        aria-label="실행 취소"
        :disabled="!canUndo || !!drag"
        data-testid="memo-block-move-undo"
        @click="undo"
      />
      <UButton
        icon="i-material-symbols-redo"
        color="neutral"
        variant="ghost"
        class="size-11 justify-center"
        aria-label="다시 실행"
        :disabled="!canRedo || !!drag"
        data-testid="memo-block-move-redo"
        @click="redo"
      />
      <UButton
        icon="i-material-symbols-check"
        color="neutral"
        variant="ghost"
        class="size-11 justify-center"
        aria-label="블록 이동 완료"
        data-testid="memo-block-move-done"
        @click="finish"
      />
    </template>
    <!-- 본문 래퍼 안에서 함께 스크롤한다. overflow: clip은 별도 스크롤 컨테이너를 만들지 않는다. -->
    <Teleport v-if="active && overlayTarget && !sidebarOpen" :to="overlayTarget">
      <div
        class="mobile-block-move-controls pointer-events-none absolute inset-0 z-10 overflow-clip"
        data-testid="memo-block-move-handles"
        @contextmenu.prevent
        @dragstart.prevent
        @selectstart.prevent
      >
        <template v-for="row in rows" :key="row.index">
          <UButton
            icon="i-material-symbols-add"
            color="neutral"
            variant="ghost"
            size="sm"
            :ui="{ leadingIcon: 'translate-x-2' }"
            class="pointer-events-auto absolute size-11 touch-manipulation justify-center"
            :style="handleStyle(row, 'add')"
            :draggable="false"
            :disabled="!!drag"
            :aria-label="`${row.index + 1}번째 ${row.label} 아래에 블록 넣기`"
            :data-testid="`memo-block-move-add-${row.index}`"
            @pointerdown.prevent
            @click.stop.prevent="addBlock(row)"
          />
          <UButton
            icon="i-material-symbols-drag-indicator"
            :color="drag?.moving && drag.from === row.index ? 'primary' : 'neutral'"
            variant="ghost"
            size="sm"
            class="mobile-block-move-handle pointer-events-auto absolute size-11 select-none justify-center"
            :style="handleStyle(row)"
            :draggable="false"
            :disabled="!!drag && drag.from !== row.index"
            :aria-label="`${row.index + 1}번째 ${row.label} · 끌어서 이동`"
            aria-describedby="memo-block-move-keyboard-help"
            :data-testid="`memo-block-move-handle-${row.index}`"
            @pointerdown="startPointer($event, row)"
            @click.prevent
            @keydown.up.prevent="move(row.index, row.index - 1, true)"
            @keydown.down.prevent="move(row.index, row.index + 2, true)"
            @contextmenu.prevent
            @dragstart.prevent
          />
        </template>
        <div
          v-if="lineY !== null"
          class="absolute right-3 h-1 rounded-full bg-primary"
          :style="{ top: `${lineY}px`, left: `${Math.max(rows[0]?.contentLeft ?? 16, 8)}px` }"
          data-testid="memo-block-move-insertion"
        />
      </div>
    </Teleport>
    <span v-if="active" id="memo-block-move-keyboard-help" class="sr-only">손잡이를 끌거나 위아래 방향키로 블록을 옮기세요. Escape를 누르면 이동 모드를 닫습니다.</span>
    <span role="status" aria-live="polite" class="sr-only">{{ announcement }}</span>
  </div>
</template>

<style>
/* main.css의 비레이어 전역 touch-action은 Tailwind utility보다 우선한다.
 * 손잡이의 예외도 같은 레이어에서 선언해야 터치가 스크롤로 넘어가 pointercancel되지 않는다. */
.mobile-block-move-handle {
  touch-action: none;
}

.mobile-block-move-active,
.mobile-block-move-controls,
.mobile-block-move-controls * {
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
}
</style>
