/**
 * 폰 껍데기(app-ios)의 네이티브 툴바와 에디터를 잇는다 (설계문서 §10.2).
 *
 * 네이티브 → 웹: window.memoEditor.exec(명령)   — 서식 로직은 여기(웹)에만 있다
 * 웹 → 네이티브: MemoNative.postMessage({ type: 'focus' | 'blur' | 'state', … })
 *
 * 🔴 계약의 «모양»을 바꾸지 않는다. 껍데기는 기기에 설치돼 있고 웹은 따로 배포되므로 둘의 버전은
 *    언제든 어긋난다 (pic-blog 에서 한 번 깨졌다). 새 명령·새 상태는 «추가»만 한다 — 모르는 쪽은 무시한다.
 */
import type { Editor } from '@tiptap/vue-3'

export type NativeCommand =
  | 'block'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'image'
  | 'undo'
  | 'redo'

interface NativeChannel {
  postMessage: (message: string) => void
}

interface NativeWindow extends Window {
  MemoNative?: NativeChannel
  memoEditor?: { exec: (command: NativeCommand) => void }
}

/** 껍데기 안인가 — webview_flutter 가 문서보다 먼저 MemoNative 를 심는다 */
export function inNativeShell() {
  return !!(window as NativeWindow).MemoNative
}

export function useNativeBridge(getEditor: () => Editor | undefined, onLink: () => void) {
  const win = window as NativeWindow
  const channel = win.MemoNative ?? null
  let attachedEditor: Editor | null = null
  let resizeObserver: ResizeObserver | null = null
  let revealTimer: ReturnType<typeof setTimeout> | null = null
  let revealFrame = 0

  function post(message: Record<string, string | number | boolean>) {
    channel?.postMessage(JSON.stringify(message))
  }

  function cancelReveal() {
    if (revealTimer !== null) clearTimeout(revealTimer)
    if (revealFrame) cancelAnimationFrame(revealFrame)
    revealTimer = null
    revealFrame = 0
  }

  /** 키보드·Flutter 툴바가 자리를 잡은 뒤, 가려진 커서만 문서 패널 안에서 올린다. */
  function revealCursor() {
    const editor = attachedEditor
    if (!editor || editor.isDestroyed || !editor.isFocused || !editor.state.selection.empty) return
    const panel = editor.view.dom.closest<HTMLElement>('[data-slot="body"]')
    if (!panel || !panel.clientHeight) return

    const caret = editor.view.coordsAtPos(editor.state.selection.head)
    const bounds = panel.getBoundingClientRect()
    const viewport = win.visualViewport
    // 공통 헤더는 패널 밖에 있다. 패널의 실제 상단부터가 편집 영역이다.
    const top = Math.max(bounds.top, viewport?.offsetTop ?? 0) + 16
    const bottom = Math.min(bounds.bottom, win.innerHeight, viewport ? viewport.offsetTop + viewport.height : win.innerHeight) - 16
    if (bottom <= top) return

    const delta = caret.top < top ? caret.top - top : caret.bottom > bottom ? caret.bottom - bottom : 0
    if (delta) {
      panel.scrollBy({
        top: delta,
        behavior: win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    }
  }

  function queueReveal() {
    cancelReveal()
    // 포커스 순간에는 아직 화면이 크다. 툴바 애니메이션 중의 resize 를 모아 마지막 배치에서 잰다.
    revealTimer = setTimeout(() => {
      revealTimer = null
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0
        revealCursor()
      })
    }, 120)
  }

  function onFocus() {
    post({ type: 'focus' })
    queueReveal()
  }

  function onBlur() {
    cancelReveal()
    post({ type: 'blur' })
  }

  function onTransaction() {
    if (attachedEditor) post({ type: 'state', ...stateOf(attachedEditor) })
  }

  function stateOf(editor: Editor) {
    return {
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      link: editor.isActive('link'),
      heading: [1, 2, 3].find((level) => editor.isActive('heading', { level })) ?? 0,
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }
  }

  function exec(command: NativeCommand) {
    const editor = getEditor()
    if (!editor) return
    const chain = editor.chain().focus()
    switch (command) {
      // `/` 를 넣으면 블록 메뉴가 뜬다 — 키보드에서 기호판으로 바꾸지 않아도 되게
      case 'block':
        chain.insertContent('/').run()
        break
      case 'h1':
      case 'h2':
      case 'h3':
        chain.toggleHeading({ level: Number(command[1]) as 1 | 2 | 3 }).run()
        break
      case 'bold':
        chain.toggleBold().run()
        break
      case 'italic':
        chain.toggleItalic().run()
        break
      case 'underline':
        chain.toggleUnderline().run()
        break
      case 'strike':
        chain.toggleStrike().run()
        break
      case 'link':
        onLink()
        break
      // 파일 고르기는 «사람의 탭» 안에서만 열린다 — 올리기 자리를 넣고 거기를 누르게 한다
      case 'image':
        chain.insertContent({ type: 'imageUpload' }).run()
        break
      case 'undo':
        chain.undo().run()
        break
      case 'redo':
        chain.redo().run()
        break
    }
  }

  /** 에디터가 생긴 뒤 한 번 붙인다 */
  function attach(editor: Editor) {
    if (!channel) return
    attachedEditor = editor
    win.memoEditor = { exec }
    editor.on('focus', onFocus)
    editor.on('blur', onBlur)
    editor.on('transaction', onTransaction)
    editor.on('selectionUpdate', queueReveal)
    win.addEventListener('resize', queueReveal)
    win.visualViewport?.addEventListener('resize', queueReveal)
    const panel = editor.view.dom.closest<HTMLElement>('[data-slot="body"]')
    if (panel) {
      resizeObserver = new ResizeObserver(queueReveal)
      resizeObserver.observe(panel)
    }
  }

  onBeforeUnmount(() => {
    if (!channel) return
    cancelReveal()
    resizeObserver?.disconnect()
    win.removeEventListener('resize', queueReveal)
    win.visualViewport?.removeEventListener('resize', queueReveal)
    attachedEditor?.off('focus', onFocus)
    attachedEditor?.off('blur', onBlur)
    attachedEditor?.off('transaction', onTransaction)
    attachedEditor?.off('selectionUpdate', queueReveal)
    attachedEditor = null
    post({ type: 'blur' })
    delete win.memoEditor
  })

  return { attach, native: !!channel }
}
