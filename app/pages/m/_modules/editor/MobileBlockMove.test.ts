import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Schema } from '@tiptap/pm/model'
import { closeHistory, history, undo, redo } from '@tiptap/pm/history'
import { EditorState } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { computed, ref, shallowRef } from 'vue'
import * as Vue from 'vue'
import type { Ref, VNode } from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as blockMove from './block-move'

// 템플릿 복사본 대신 SFC의 실제 setup을 실행한다. DOM 배치 자체는 브라우저에서 별도로 확인한다.
const vueRequire = createRequire(import.meta.resolve('vue'))
const { parse, compileScript } = vueRequire('@vue/compiler-sfc') as {
  parse: (source: string) => { descriptor: unknown }
  compileScript: (descriptor: unknown, options: { id: string }) => { content: string }
}
const source = readFileSync(new URL('./MobileBlockMove.vue', import.meta.url), 'utf8')
const script = compileScript(parse(source).descriptor, { id: 'mobile-block-move-test' })
const executable = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const { compile } = vueRequire('@vue/compiler-dom') as { compile: (source: string, options: object) => { code: string } }
const { template } = vueRequire('@vue/compiler-sfc').parse(source).descriptor as { template: { content: string } }
const templateCode = compile(template.content, { mode: 'function', prefixIdentifiers: true }).code
// 실제 템플릿 바인딩으로 이벤트·레이어·공통 버튼 토큰을 확인한다. 픽셀/CSS는 개발 브라우저에서 확인한다.
const renderTemplate = runInNewContext(`(function () { ${templateCode} })()`, { Vue: { ...Vue, resolveComponent: (name: string) => name } }) as (ctx: object, cache: unknown[]) => VNode
function templateNodes(h: ReturnType<typeof mount>): VNode[] {
  const root = renderTemplate(Vue.proxyRefs({ ...h.setup, disabled: h.props.disabled, sidebarOpen: h.sidebarOpen }), [])
  const nodes: VNode[] = []
  function visit(node: VNode) {
    if (!Vue.isVNode(node)) return
    nodes.push(node)
    if (Array.isArray(node.children)) for (const child of node.children) visit(child as VNode)
  }
  visit(root)
  return nodes
}
function templateButton(h: ReturnType<typeof mount>, name: string) {
  return templateNodes(h).find(node => node.props?.['data-testid'] === `memo-block-move-${name}`)!
}

type Listener = (...args: never[]) => void
class Surface {
  listeners = new Map<string, Set<Listener>>()
  addEventListener(name: string, handler: Listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name)!.add(handler)
  }
  removeEventListener(name: string, handler: Listener) { this.listeners.get(name)?.delete(handler) }
  count(name: string) { return this.listeners.get(name)?.size ?? 0 }
}
class Element extends Surface {
  style = { paddingLeft: '12px', paddingRight: '7px' }
  classes = new Set<string>()
  classList = { add: (name: string) => this.classes.add(name), remove: (name: string) => this.classes.delete(name) }
  captures = new Set<number>()
  scrollBy = vi.fn()
  focus = vi.fn()
  querySelector = vi.fn(() => this)
  parentElement: Element | null = null
  scrollTop = 0
  constructor(public top = 0, public bottom = 700, readonly parent: Element | null = null) { super() }
  getBoundingClientRect() { return { top: this.top, bottom: this.bottom, height: this.bottom - this.top, left: 112, right: 370 } }
  closest() { return this.parent }
  setPointerCapture(id: number) { this.captures.add(id) }
  hasPointerCapture(id: number) { return this.captures.has(id) }
  releasePointerCapture(id: number) { this.captures.delete(id) }
}
type Row = blockMove.TopLevelBlock & { top: number; bottom: number; left: number; right: number; handleTop: number }
interface Setup {
  active: Ref<boolean>
  rows: Ref<Row[]>
  drag: Ref<{ moving: boolean } | null>
  overlayTarget: Ref<Element | null>
  announcement: Ref<string>
  enter: () => void
  finish: () => void
  startPointer: (event: PointerEvent, row: Row) => void
  movePointer: (event: PointerEvent) => void
  endPointer: (event: PointerEvent) => void
  cancelPointer: (event: PointerEvent) => void
  move: (from: number, boundary: number, focusHandle?: boolean) => void
  addBlock: (row: Row) => void
  onVisibility: () => void
  handleStyle: (row: Row, kind?: 'add' | 'drag') => { top: string; left: string }
}
const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} } })

function mount(disabled = false, editable = true) {
  const mounted: (() => void)[] = []
  const unmounted: (() => void)[] = []
  const frames = new Map<number, () => void>()
  let nextFrame = 0
  const panel = new Element()
  panel.scrollBy.mockImplementation(({ top }: { top: number }) => { panel.scrollTop += top })
  const content = new Element(80, 780, panel)
  content.getBoundingClientRect = () => ({ top: 80 - panel.scrollTop, bottom: 780 - panel.scrollTop, height: 700, left: 16, right: 390 })
  const dom = new Element(0, 700, panel)
  dom.parentElement = content
  const selection = { removeAllRanges: vi.fn() }
  const window = Object.assign(new Surface(), { getSelection: () => selection, innerHeight: 700, innerWidth: 390, visualViewport: Object.assign(new Surface(), { offsetTop: 0, height: 700 }), matchMedia: () => media })
  const media = new Surface()
  const document = Object.assign(new Surface(), { visibilityState: 'visible' })
  const observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  const subscribers = new Set<() => void>()
  const toast = { add: vi.fn() }
  const emitted = vi.fn()
  const sidebarOpen = ref(false)
  const editor = {
    state: EditorState.create({ doc: schema.node('doc', null, ['A', 'B', 'C'].map(text => schema.node('paragraph', null, schema.text(text)))), plugins: [history()] }),
    isDestroyed: false,
    isEditable: editable,
    setEditable: vi.fn((value: boolean) => { editor.isEditable = value }),
    commands: {
      blur: vi.fn(), setMeta: vi.fn(),
      undo: () => undo(editor.state, tr => editor.view.dispatch(tr)),
      redo: () => redo(editor.state, tr => editor.view.dispatch(tr)),
    },
    can: () => ({ undo: () => undo(editor.state), redo: () => redo(editor.state) }),
    on: (_name: string, handler: () => void) => subscribers.add(handler),
    off: (_name: string, handler: () => void) => subscribers.delete(handler),
    view: {
      dom,
      nodeDOM: (pos: number) => {
        const index = blockMove.getTopLevelBlocks(editor.state.doc).findIndex(block => block.pos === pos)
        return new Element(100 + index * 100 - panel.scrollTop, 150 + index * 100 - panel.scrollTop)
      },
      dispatch: vi.fn((tr: Transaction) => {
        editor.state = editor.state.apply(tr)
        for (const handler of subscribers) handler()
      }),
    },
  }
  const module = { exports: {} as { default: { setup: (props: object, context: object) => Setup } } }
  runInNewContext(executable, {
    exports: module.exports, module,
    require: (name: string) => {
      if (name === 'vue') return { ...Vue, defineComponent: (options: object) => options, useModel: (props: Record<string, boolean>, name: string) => ref(props[name] ?? false) }
      if (name === '@tiptap/pm/history') return { closeHistory }
      if (name === './block-move') return blockMove
      throw new Error(`예상하지 않은 런타임 의존성: ${name}`)
    },
    ref, shallowRef, computed, watch: Vue.watch, useToast: () => toast,
    useMobileMenuNavigation: () => ({ open: sidebarOpen }),
    nextTick: (callback: () => void) => { callback(); return Promise.resolve() },
    onMounted: (callback: () => void) => mounted.push(callback),
    onBeforeUnmount: (callback: () => void) => unmounted.push(callback),
    window, document, HTMLElement: Element,
    getComputedStyle: () => ({ lineHeight: '28px' }),
    ResizeObserver: class {
      observe = vi.fn()
      disconnect = vi.fn()
      constructor() { observers.push(this) }
    },
    requestAnimationFrame: (callback: () => void) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  })
  const props = { editor, disabled }
  const setup = module.exports.default.setup(props, { expose: () => {}, emit: emitted })
  for (const callback of mounted) callback()
  function flushFrames() {
    const pending = [...frames.entries()]
    for (const [id, callback] of pending) { frames.delete(id); callback() }
  }
  function enter() { setup.enter(); flushFrames() }
  function pointer(target: Element, x = 350, y = 120, id = 1, pointerType = 'mouse'): PointerEvent {
    return { currentTarget: target, clientX: x, clientY: y, pointerId: id, pointerType, isPrimary: true, button: 0, preventDefault: vi.fn() } as unknown as PointerEvent
  }
  return { setup, props, editor, dom, panel, content, selection, window, document, media, observers, frames, subscribers, toast, emitted, sidebarOpen, flushFrames, enter, pointer, unmount: () => unmounted.forEach(callback => callback()) }
}

describe('모바일 블록 이동의 실제 setup 동작', () => {
  it('이동 모드에서만 편집을 잠그고 완료하면 기존 편집 상태와 padding을 복원한다', () => {
    const h = mount()
    h.enter()
    expect(h.setup.active.value).toBe(true)
    expect(h.editor.commands.blur).toHaveBeenCalledOnce()
    expect(h.editor.commands.setMeta).toHaveBeenCalledWith('hideDragHandle', true)
    expect(h.editor.isEditable).toBe(false)
    expect(h.dom.style.paddingLeft).toBe('72px')
    expect(h.dom.style.paddingRight).toBe('7px')
    expect(h.setup.rows.value).toHaveLength(3)
    expect(h.setup.overlayTarget.value).toBe(h.content)
    expect(h.dom.count('click')).toBe(1)
    h.setup.finish()
    expect(h.editor.isEditable).toBe(true)
    expect(h.dom.style.paddingLeft).toBe('12px')
    expect(h.dom.count('click')).toBe(0)
    expect(h.setup.active.value).toBe(false)
    expect(h.setup.rows.value).toEqual([])
    expect(h.setup.overlayTarget.value).toBeNull()
    expect(h.document.count('scroll')).toBe(0)
    expect(h.window.visualViewport.count('resize')).toBe(0)
    expect(h.observers[0]!.disconnect).toHaveBeenCalledOnce()
  })

  it('비활성 상태로 진입할 수 없고 원래 읽기 전용이었던 에디터를 편집 가능하게 바꾸지 않는다', () => {
    const disabled = mount(true)
    disabled.enter()
    expect(disabled.setup.active.value).toBe(false)
    expect(disabled.editor.commands.blur).not.toHaveBeenCalled()
    const readonly = mount(false, false)
    readonly.enter()
    readonly.setup.finish()
    expect(readonly.editor.isEditable).toBe(false)
  })

  it('44px 손잡이 중심은 문단 첫 줄 중앙에 맞고 본문 블록 높이는 유지된다', () => {
    const h = mount()
    h.enter()
    for (const row of h.setup.rows.value) {
      const style = h.setup.handleStyle(row)
      expect(Number.parseFloat(style.top) + 22).toBe(row.top - h.content.getBoundingClientRect().top + 28 / 2)
      expect(row.bottom - row.top).toBe(50)
      const add = h.setup.handleStyle(row, 'add')
      expect(Number.parseFloat(add.left) + 44).toBe(Number.parseFloat(style.left))
      expect(Number.parseFloat(style.left) + 44).toBe(row.left - h.content.getBoundingClientRect().left)
      expect(add.top).toBe(style.top)
    }
  })

  it('왼쪽 +는 해당 블록 위치를 전달하기 전에 편집을 복원하고 모드를 닫는다', () => {
    const h = mount()
    h.enter()
    h.emitted.mockImplementation(() => { expect(h.editor.isEditable).toBe(true); expect(h.setup.active.value).toBe(false) })
    const plus = templateButton(h, 'add-1')
    expect(plus.props).toMatchObject({ icon: 'i-material-symbols-add', color: 'neutral', variant: 'ghost', size: 'sm' })
    expect(plus.props!.ui).toEqual({ leadingIcon: 'translate-x-2' })
    expect(templateButton(h, 'handle-1').props!.ui).toBeUndefined()
    plus.props!.onClick({ stopPropagation: vi.fn(), preventDefault: vi.fn() })
    expect(h.emitted).toHaveBeenCalledWith('addBlock', 3)
    expect(h.editor.view.dispatch).not.toHaveBeenCalled()
    expect(h.dom.style.paddingLeft).toBe('12px')
    expect(h.dom.style.paddingRight).toBe('7px')
  })

  it('드래그 중 또는 sidebar 뒤의 +는 편집 잠금을 풀거나 추가하지 않는다', () => {
    const h = mount()
    h.enter()
    const row = h.setup.rows.value[0]!
    h.setup.startPointer(h.pointer(new Element()), row)
    h.setup.addBlock(row)
    expect(h.emitted).not.toHaveBeenCalled()
    h.sidebarOpen.value = true
    h.setup.addBlock(row)
    expect(h.emitted).not.toHaveBeenCalled()
    expect(h.editor.isEditable).toBe(false)
  })

  it('손잡이 탭과 작은 손 떨림은 문서를 옮기지 않고 capture만 정리한다', () => {
    const h = mount()
    h.enter()
    const target = new Element()
    const row = h.setup.rows.value[1]!
    h.setup.startPointer(h.pointer(target, 350, 220), row)
    h.setup.movePointer(h.pointer(target, 353, 222))
    h.setup.endPointer(h.pointer(target, 353, 222))
    expect(h.editor.view.dispatch).not.toHaveBeenCalled()
    expect(target.captures.size).toBe(0)
    expect(h.window.count('pointermove')).toBe(0)
  })

  it('손잡이 드래그는 한 번 이동하고 한 번 undo로 원래 순서로 되돌린다', () => {
    const h = mount()
    h.enter()
    const target = new Element()
    const row = h.setup.rows.value[0]!
    h.setup.startPointer(h.pointer(target), row)
    h.setup.movePointer(h.pointer(target, 350, 420))
    expect(h.setup.drag.value?.moving).toBe(true)
    h.setup.endPointer(h.pointer(target, 350, 420))
    expect(h.editor.state.doc.textContent).toBe('BCA')
    expect(h.editor.view.dispatch).toHaveBeenCalledTimes(2)
    expect(h.setup.announcement.value).toContain('1번째 블록을 3번째')
    h.editor.commands.undo()
    expect(h.editor.state.doc.textContent).toBe('ABC')
    expect(h.frames.size).toBeLessThanOrEqual(1)
  })

  it('touch 포인터는 실제 손잡이 바인딩에서 시작해 왼쪽 세로 이동·드롭·undo/redo까지 이어진다', () => {
    const h = mount()
    h.enter()
    const target = new Element()
    const handle = templateButton(h, 'handle-0')
    handle.props!.onPointerdown(h.pointer(target, 70, 120, 9, 'touch'))
    for (const listener of h.window.listeners.get('pointermove') ?? []) {
      ;(listener as (event: PointerEvent) => void)(h.pointer(target, 70, 420, 9, 'touch'))
    }
    expect(h.setup.drag.value?.moving).toBe(true)
    expect(target.captures.has(9)).toBe(true)
    expect(templateButton(h, 'handle-0').props!.disabled).toBe(false)
    for (const listener of [...h.window.listeners.get('pointerup') ?? []]) {
      ;(listener as (event: PointerEvent) => void)(h.pointer(target, 70, 420, 9, 'touch'))
    }
    expect(h.editor.state.doc.textContent).toBe('BCA')
    expect(target.captures.size).toBe(0)
    expect(h.window.count('pointermove')).toBe(0)
    h.editor.commands.undo()
    expect(h.editor.state.doc.textContent).toBe('ABC')
    h.editor.commands.redo()
    expect(h.editor.state.doc.textContent).toBe('BCA')
  })

  it('가장자리 자동 스크롤 중에도 잡은 손잡이는 포인터를 따르고 드롭은 최신 본문 좌표로 처리한다', () => {
    const h = mount()
    h.enter()
    const target = new Element()
    h.setup.startPointer(h.pointer(target, 70, 120), h.setup.rows.value[0]!)
    h.setup.movePointer(h.pointer(target, 70, 650))
    h.flushFrames()
    expect(h.panel.scrollBy).toHaveBeenCalled()
    expect(h.panel.scrollTop).toBeGreaterThan(0)
    const dragged = h.setup.handleStyle(h.setup.rows.value[0]!)
    expect(Number.parseFloat(dragged.top) + h.content.getBoundingClientRect().top + 22).toBe(650)
    expect(Number.parseFloat(dragged.left) + h.content.getBoundingClientRect().left + 22).toBe(70)
    h.setup.endPointer(h.pointer(target, 70, 650))
    expect(h.editor.state.doc.textContent).toBe('BCA')
    expect(target.captures.size).toBe(0)
    expect(h.frames.size).toBeLessThanOrEqual(1)
  })

  it('키보드 이동은 이동한 블록의 손잡이로 포커스를 옮기고 경계에서는 그대로 둔다', () => {
    const h = mount()
    h.enter()
    h.setup.move(0, 2, true)
    expect(h.editor.state.doc.textContent).toBe('BAC')
    expect(h.content.querySelector).toHaveBeenCalledWith('[data-testid="memo-block-move-handle-1"]')
    expect(h.content.focus).toHaveBeenCalledWith({ preventScroll: true })
    h.setup.move(0, -1, true)
    expect(h.editor.state.doc.textContent).toBe('BAC')
    expect(h.editor.view.dispatch).toHaveBeenCalledTimes(2)
  })

  it('진입·완료는 기존 메모 메뉴와 같은 ghost 아이콘 버튼이고 화면 안내/모달을 만들지 않는다', () => {
    const h = mount()
    const entry = templateButton(h, 'start')
    expect(entry.type).toBe('UButton')
    expect(entry.props).toMatchObject({ icon: 'i-material-symbols-drag-indicator', color: 'neutral', variant: 'ghost', 'aria-label': '블록 이동' })
    expect(entry.props!.class).toContain('size-11')
    h.enter()
    const done = templateButton(h, 'done')
    expect(done.props).toMatchObject({ icon: 'i-material-symbols-check', color: 'neutral', variant: 'ghost', 'aria-label': '블록 이동 완료' })
    const nodes = templateNodes(h)
    expect(nodes.some(node => node.type === 'UModal' || node.props?.['data-testid'] === 'memo-block-move-hint')).toBe(false)
    for (const node of nodes.filter(node => node.type === 'UButton')) {
      expect(node.props!.variant).toBe('ghost')
      expect(node.props!.class).toContain('size-11')
      expect(node.children).toBeNull()
    }
  })

  it('실제 손잡이 템플릿은 탭 모달 없이 방향키로 이동하고 패널 안에서만 표시된다', () => {
    const h = mount()
    h.enter()
    const handle = templateButton(h, 'handle-0')
    expect(handle.props!['aria-haspopup']).toBeUndefined()
    handle.props!.onClick({ preventDefault: vi.fn() })
    expect(h.editor.view.dispatch).not.toHaveBeenCalled()
    const handlers = handle.props!.onKeydown as ((event: object) => void)[]
    for (const handler of handlers) handler({ key: 'ArrowDown', preventDefault: vi.fn() })
    expect(h.editor.state.doc.textContent).toBe('BAC')
    const teleport = templateNodes(h).find(node => node.type === Vue.Teleport && node.props!.to === h.content)
    expect(teleport).toBeDefined()
    h.sidebarOpen.value = true
    expect(templateNodes(h).some(node => node.props?.['data-testid'] === 'memo-block-move-handles')).toBe(false)
  })

  it('사이드바 열림은 진행 중 drag를 취소하고 뒤에서 새 이동을 막는다', () => {
    const h = mount()
    h.enter()
    const target = new Element()
    h.setup.startPointer(h.pointer(target), h.setup.rows.value[0]!)
    h.setup.movePointer(h.pointer(target, 350, 650))
    h.sidebarOpen.value = true
    expect(h.setup.drag.value).toBeNull()
    expect(target.captures.size).toBe(0)
    h.setup.endPointer(h.pointer(target, 350, 650))
    h.setup.startPointer(h.pointer(target), h.setup.rows.value[0]!)
    h.setup.move(0, 3)
    expect(h.editor.state.doc.textContent).toBe('ABC')
    expect(h.editor.view.dispatch).not.toHaveBeenCalled()
    expect(h.setup.active.value).toBe(true)
  })

  it('본문과 같은 콘텐츠 좌표를 사용해 스크롤 재측정 전에도 손잡이가 정확히 함께 움직인다', () => {
    const h = mount()
    h.enter()
    const before = h.setup.handleStyle(h.setup.rows.value[0]!)
    expect(h.setup.overlayTarget.value).toBe(h.content)
    const initialScreenTop = Number.parseFloat(before.top) + h.content.getBoundingClientRect().top
    h.panel.scrollTop = 240
    // 브라우저의 비동기 스크롤 중 JS/rAF가 아직 실행되지 않아도 같은 부모가 이동한다.
    expect(Number.parseFloat(h.setup.handleStyle(h.setup.rows.value[0]!).top) + h.content.getBoundingClientRect().top).toBe(initialScreenTop - 240)
    for (const listener of h.document.listeners.get('scroll') ?? []) listener()
    h.flushFrames()
    expect(h.setup.handleStyle(h.setup.rows.value[0]!)).toEqual(before)
    const controls = templateNodes(h).find(node => node.props?.['data-testid'] === 'memo-block-move-handles')!
    expect(controls.props!.class).toContain('absolute')
    expect(controls.props!.class).not.toContain('fixed')
    expect(templateButton(h, 'handle-0')).toBeDefined()
    expect(templateButton(h, 'add-0')).toBeDefined()
  })

  it('이전 네이티브 텍스트 선택을 지우고 컨트롤 전체에서 선택·기본 드래그·팝업을 차단한다', () => {
    const h = mount()
    h.enter()
    expect(h.selection.removeAllRanges).toHaveBeenCalledOnce()
    const controls = templateNodes(h).find(node => node.props?.['data-testid'] === 'memo-block-move-handles')!
    for (const name of ['onContextmenu', 'onDragstart', 'onSelectstart']) {
      const event = { preventDefault: vi.fn() }
      controls.props![name](event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    for (const name of ['add-0', 'handle-0']) expect(templateButton(h, name).props!.draggable).toBe(false)
  })

  it.each(['pointercancel', '내용 변경', '화면 숨김'] as const)('%s 시 이동하지 않고 포인터와 스크롤 frame을 해제한다', (reason) => {
    const h = mount()
    h.enter()
    const target = new Element()
    h.setup.startPointer(h.pointer(target), h.setup.rows.value[0]!)
    h.setup.movePointer(h.pointer(target, 350, 650))
    if (reason === 'pointercancel') h.setup.cancelPointer(h.pointer(target))
    if (reason === '내용 변경') h.editor.view.dispatch(h.editor.state.tr.insertText('x', 2))
    if (reason === '화면 숨김') { h.document.visibilityState = 'hidden'; h.setup.onVisibility() }
    expect(h.setup.drag.value).toBeNull()
    expect(target.captures.size).toBe(0)
    expect(target.count('lostpointercapture')).toBe(0)
    expect(h.window.count('pointermove')).toBe(0)
    expect(h.window.count('pointerup')).toBe(0)
    expect(h.window.count('pointercancel')).toBe(0)
    expect(h.editor.state.doc.textContent).toBe(reason === '내용 변경' ? 'AxBC' : 'ABC')
    // transaction이 예약한 재측정 한 개는 허용하되 자동 스크롤은 취소되어야 한다.
    h.flushFrames()
    expect(h.frames.size).toBe(0)
    expect(h.panel.scrollBy).not.toHaveBeenCalled()
  })

  it('unmount는 진행 중 드래그·모든 리스너·observer·프레임을 정리하고 편집을 복원한다', () => {
    const h = mount()
    h.enter()
    const target = new Element()
    h.setup.startPointer(h.pointer(target), h.setup.rows.value[0]!)
    h.setup.movePointer(h.pointer(target, 350, 650))
    h.unmount()
    expect(h.setup.active.value).toBe(false)
    expect(h.editor.isEditable).toBe(true)
    expect(h.dom.style.paddingLeft).toBe('12px')
    expect(target.captures.size).toBe(0)
    expect(h.frames.size).toBe(0)
    expect(h.subscribers.size).toBe(0)
    for (const surface of [h.window, h.document, h.window.visualViewport, h.media, h.dom, target]) {
      expect([...surface.listeners.values()].every(listeners => listeners.size === 0)).toBe(true)
    }
    expect(h.observers[0]!.disconnect).toHaveBeenCalledOnce()
  })
})
