<script setup lang="ts">
import type { JSONContent } from '@tiptap/core'
import type { NodeViewProps } from '@tiptap/vue-3'
import { NodeViewWrapper } from '@tiptap/vue-3'
import { MAX_ATTACHMENT_BYTES } from '#shared/utils/attachments'
import type { AttachmentUploadOptions } from './AttachmentUploadExtension'

const props = defineProps<NodeViewProps>()

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'error'; message: string }

const state = ref<UploadState>({ status: 'idle' })
const fileUpload = useTemplateRef('fileUpload')
let controller: AbortController | null = null

onMounted(() => {
  fileUpload.value?.inputRef?.setAttribute('data-testid', 'memo-attachment-file-input')
  fileUpload.value?.dropzoneRef?.setAttribute('data-testid', 'memo-attachment-picker-open')
})
onBeforeUnmount(() => controller?.abort())

function stopFileDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) event.stopPropagation()
}

async function uploadFile(file: File | null | undefined) {
  if (!file || state.value.status === 'uploading' || !props.editor.isEditable) return
  if (file.size > MAX_ATTACHMENT_BYTES) {
    state.value = { status: 'error', message: '첨부파일은 30MB까지 올릴 수 있습니다' }
    return
  }
  const uploadId = props.node.attrs.uploadId
  const request = new AbortController()
  const options: AttachmentUploadOptions = props.extension.options
  controller = request
  state.value = { status: 'uploading' }
  try {
    const href = await options.upload(file, request.signal)
    const pos = props.getPos()
    if (request.signal.aborted || props.editor.isDestroyed || typeof pos !== 'number') return
    const current = props.editor.state.doc.nodeAt(pos)
    if (!current || current.type.name !== 'attachmentUpload' || current.attrs.uploadId !== uploadId) return
    const attachment: JSONContent = {
      type: 'paragraph',
      content: [{ type: 'text', text: file.name, marks: [{ type: 'link', attrs: { href } }] }],
    }
    props.editor.commands.insertContentAt({ from: pos, to: pos + current.nodeSize }, attachment, { updateSelection: false })
  } catch (error) {
    if (!request.signal.aborted) {
      state.value = { status: 'error', message: apiMessage(error, '파일을 올리지 못했습니다') }
    }
  } finally {
    controller = null
    if (!request.signal.aborted && state.value.status === 'uploading') state.value = { status: 'idle' }
  }
}
</script>

<template>
  <NodeViewWrapper data-testid="memo-attachment-upload" @drop="stopFileDrop" @dragover="stopFileDrop">
    <UFileUpload
      ref="fileUpload"
      aria-label="첨부할 파일"
      :label="state.status === 'error' ? '파일 다시 선택' : '파일 첨부'"
      :preview="false"
      :reset="true"
      :disabled="state.status === 'uploading' || !editor.isEditable"
      class="min-h-40"
      :ui="{ description: state.status === 'error' ? 'text-error' : '' }"
      @update:model-value="uploadFile"
    >
      <template #leading>
        <UAvatar
          :icon="state.status === 'error' ? 'i-material-symbols-error-outline' : state.status === 'uploading' ? 'i-material-symbols-progress-activity' : 'i-material-symbols-attach-file'"
          size="xl"
          :ui="{ icon: [state.status === 'uploading' && 'animate-spin', state.status === 'error' && 'text-error'] }"
        />
      </template>
      <template #description>
        <span role="status">{{ state.status === 'error' ? state.message : state.status === 'uploading' ? '파일을 올리는 중입니다' : '파일당 최대 30MB' }}</span>
      </template>
    </UFileUpload>
  </NodeViewWrapper>
</template>

<style scoped></style>
