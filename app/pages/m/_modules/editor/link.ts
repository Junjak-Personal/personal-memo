/**
 * 링크 넣기·지우기 — PC 말풍선(LinkPopover)과 폰의 네이티브 툴바(LinkDialog)가 같이 쓴다.
 * nuxt-ui-templates/editor 의 LinkPopover 에서 꺼냈다.
 */
import type { Editor } from '@tiptap/vue-3'

export function currentLink(editor: Editor): string {
  return editor.getAttributes('link').href ?? ''
}

export function applyLink(editor: Editor, url: string) {
  if (!url) return
  const empty = editor.state.selection.empty
  let chain = editor.chain().focus()
  chain = editor.isActive('code') && !empty ? chain.extendMarkRange('code') : chain.extendMarkRange('link')
  chain = chain.setLink({ href: url })
  if (empty) chain = chain.insertContent({ type: 'text', text: url })
  chain.run()
}

export function removeLink(editor: Editor) {
  editor.chain().focus().extendMarkRange('link').unsetLink().setMeta('preventAutolink', true).run()
}
