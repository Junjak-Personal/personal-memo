<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { EditorEvents } from '@tiptap/core'
import { applyMemoPaste } from '~/utils/editor-paste'
import type { MemoPasteMode } from '~/utils/editor-paste'

const props = defineProps<{ editor: Editor; disabled?: boolean }>()
const toast = useToast()
const busy = ref(false)
const items = [[
  { label: '서식 유지', icon: 'i-material-symbols-content-paste', onSelect: () => paste('formatted'), 'data-testid': 'memo-paste-formatted' },
  { label: '서식 없이', icon: 'i-material-symbols-content-paste-go', onSelect: () => paste('plain'), 'data-testid': 'memo-paste-plain' },
  { label: 'Markdown으로', icon: 'i-material-symbols-markdown-outline', onSelect: () => paste('markdown'), 'data-testid': 'memo-paste-markdown' },
]]

async function paste(mode: MemoPasteMode) {
  if (busy.value || props.disabled || !props.editor.isEditable) return
  busy.value = true
  const editor = props.editor
  let bookmark = editor.state.selection.getBookmark()
  const mapSelection = ({ transaction }: EditorEvents['transaction']) => { bookmark = bookmark.map(transaction.mapping) }
  editor.on('transaction', mapSelection)
  try {
    let text = ''
    let html = ''
    if (mode === 'formatted' && navigator.clipboard.read) {
      const contents = await navigator.clipboard.read()
      for (const content of contents) {
        if (content.types.includes('text/plain')) text = await (await content.getType('text/plain')).text()
        if (content.types.includes('text/html')) html = await (await content.getType('text/html')).text()
        if (text || html) break
      }
    } else text = await navigator.clipboard.readText()
    if (editor.isDestroyed || !editor.isEditable) return
    editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)))
    editor.commands.focus()
    if (!applyMemoPaste(editor, text, html, mode)) toast.add({ title: '붙여넣을 글이 없습니다' })
  } catch {
    toast.add({ color: 'warning', title: '클립보드를 읽지 못했습니다', description: '본문에서 붙여넣기를 사용하세요. 서식 없이 넣으려면 Ctrl/⌘ + Shift + V를 누르세요.' })
  } finally { editor.off('transaction', mapSelection); busy.value = false }
}
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton icon="i-material-symbols-content-paste" color="neutral" variant="outline" size="sm" :loading="busy" :disabled="disabled || !editor.isEditable" aria-label="붙여넣기 방식" data-testid="memo-paste-menu" />
  </UDropdownMenu>
</template>
