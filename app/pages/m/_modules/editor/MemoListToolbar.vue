<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type {} from '~/utils/editor-interactions'

const props = defineProps<{ editor: Editor; disabled?: boolean }>()
const revision = ref(0)
function sync() { revision.value++ }
const state = computed(() => {
  revision.value
  const { editor } = props
  const list = editor.isActive('taskItem') || editor.isActive('listItem')
  return {
    visible: list && editor.isEditable && !editor.isActive('table') && !editor.isActive('codeBlock'),
    indent: editor.can().indentMemoList(),
    outdent: editor.can().outdentMemoList(),
    task: editor.isActive('taskItem'),
  }
})
onMounted(() => props.editor.on('transaction', sync))
onBeforeUnmount(() => props.editor.off('transaction', sync))
</script>

<template>
  <div v-if="state.visible" class="flex flex-wrap justify-end gap-1.5 rounded-md border border-default bg-default p-1.5 lg:hidden" role="toolbar" aria-label="목록 편집" data-testid="memo-list-toolbar">
    <UButton icon="i-material-symbols-format-indent-decrease" label="내어쓰기" color="neutral" variant="outline" size="sm" :disabled="disabled || !state.outdent" data-testid="memo-list-outdent" @pointerdown.prevent @click="editor.chain().focus().outdentMemoList().run()" />
    <UButton icon="i-material-symbols-format-indent-increase" label="들여쓰기" color="neutral" variant="outline" size="sm" :disabled="disabled || !state.indent" data-testid="memo-list-indent" @pointerdown.prevent @click="editor.chain().focus().indentMemoList().run()" />
    <UButton v-if="state.task" icon="i-material-symbols-check-box-outline" label="완료 전환" color="neutral" variant="outline" size="sm" :disabled="disabled" data-testid="memo-list-toggle" @pointerdown.prevent @click="editor.chain().focus().toggleMemoTask().run()" />
  </div>
</template>
