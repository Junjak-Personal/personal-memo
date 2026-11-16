import type { Editor, JSONContent } from '@tiptap/core'

export type MemoPasteMode = 'formatted' | 'plain' | 'markdown'

/** 글자를 노드로 넣어 HTML처럼 보이는 입력도 실행 태그로 바뀌지 않게 한다. */
export function insertMemoPlainText(editor: Editor, text: string) {
  if (!editor.isEditable || !text) return false
  if (editor.isActive('codeBlock') || !/[\r\n]/.test(text)) return editor.commands.command(({ tr }) => { tr.insertText(text); return true })
  const paragraphs: JSONContent[] = text.split(/\r\n|\r|\n/).map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) }))
  return editor.commands.insertContent(paragraphs)
}

export function applyMemoPaste(editor: Editor, text: string, html: string, mode: MemoPasteMode) {
  if (!editor.isEditable) return false
  if (mode === 'plain' || editor.isActive('codeBlock')) return insertMemoPlainText(editor, text)
  if (mode === 'markdown') return text ? editor.commands.insertContent(text, { contentType: 'markdown' }) : false
  return html ? editor.commands.insertContent(html, { contentType: 'html' }) : insertMemoPlainText(editor, text)
}
