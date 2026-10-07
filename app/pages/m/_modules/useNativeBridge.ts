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

  function post(message: Record<string, string | number | boolean>) {
    channel?.postMessage(JSON.stringify(message))
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
    win.memoEditor = { exec }
    editor.on('focus', () => post({ type: 'focus' }))
    editor.on('blur', () => post({ type: 'blur' }))
    editor.on('transaction', () => post({ type: 'state', ...stateOf(editor) }))
  }

  onBeforeUnmount(() => {
    if (!channel) return
    post({ type: 'blur' })
    delete win.memoEditor
  })

  return { attach, native: !!channel }
}
