<script setup lang="ts">
import type { NodeViewProps } from '@tiptap/vue-3'
import { NodeViewWrapper } from '@tiptap/vue-3'
import type { ImageUploadOptions } from './ImageUploadExtension'

const props = defineProps<NodeViewProps>()

const fileUploadRef = useTemplateRef('fileUploadRef')

const error = ref<string | null>(null)
const loading = ref(false)

async function onFileChange() {
  const file = fileUploadRef.value?.inputRef?.files?.[0]
  if (!file) return
  loading.value = true
  error.value = null
  try {
    const options: ImageUploadOptions = props.extension.options
    const src = await options.upload(file)
    const pos = props.getPos()
    if (typeof pos !== 'number') return
    props.editor.chain().focus().deleteRange({ from: pos, to: pos + 1 }).setImage({ src }).run()
  } catch (e) {
    error.value = apiMessage(e, e instanceof Error ? e.message : '이미지를 올리지 못했습니다')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <NodeViewWrapper data-testid="memo-image-upload">
    <UFileUpload
      ref="fileUploadRef"
      accept="image/*"
      label="이미지 올리기"
      :description="error || 'JPG, PNG, GIF, WebP · 큰 사진은 긴 변 2048px 로 줄여서 올립니다'"
      :preview="false"
      class="min-h-40"
      :ui="{ description: error ? 'text-error' : '' }"
      @update:model-value="onFileChange"
    >
      <template #leading>
        <UAvatar
          :icon="error ? 'i-material-symbols-error-outline' : loading ? 'i-material-symbols-progress-activity' : 'i-material-symbols-image-outline'"
          size="xl"
          :ui="{ icon: [loading && 'animate-spin', error && 'text-error'] }"
        />
      </template>
    </UFileUpload>
  </NodeViewWrapper>
</template>
