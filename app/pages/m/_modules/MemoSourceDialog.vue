<script setup lang="ts">
const props = withDefaults(defineProps<{ content: string; baseline?: string; saving?: boolean; error?: string }>(), { saving: false, error: '' })
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [content: string]; change: [content: string]; close: [] }>()
const draft = ref('')
const original = ref('')
const confirmDiscard = ref(false)
const submitting = ref(false)
const dirty = computed(() => draft.value !== original.value)

function close() { open.value = false; emit('close') }
function requestClose() {
  if (props.saving || submitting.value) return
  if (dirty.value) confirmDiscard.value = true
  else close()
}
function onOpen(value: boolean) { if (!value) requestClose() }
async function submit() {
  if (!dirty.value || props.saving || submitting.value) return
  submitting.value = true
  emit('submit', draft.value)
  await nextTick()
  submitting.value = false
}
function onKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing) { event.preventDefault(); void submit() }
}
watch(open, value => {
  confirmDiscard.value = submitting.value = false
  original.value = value ? (props.baseline ?? props.content) : ''
  draft.value = value ? props.content : ''
}, { immediate: true })
watch(draft, value => { if (open.value && !props.saving) emit('change', value) })
</script>

<template>
  <UModal :open="open" title="Markdown 원문 편집" description="입력한 Markdown을 원문 그대로 저장합니다. 지원하지 않는 문법은 편집 화면에서 다르게 보일 수 있습니다." :dismissible="!saving && !submitting" :close="!saving && !submitting" :ui="{ content: 'sm:max-w-4xl', body: 'min-h-0' }" @update:open="onOpen">
    <template #body>
      <UTextarea v-model="draft" :rows="16" :disabled="saving" :spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Markdown 본문 원문" class="w-full" :ui="{ base: 'min-h-64 max-h-[60dvh] resize-y font-mono text-sm' }" data-testid="memo-source-content-input" @keydown="onKey" />
      <p class="mt-2 text-xs text-muted">{{ draft.length.toLocaleString('ko-KR') }}자 · Ctrl/Cmd+Enter로 저장</p>
      <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mt-3" data-testid="memo-source-error" />
      <UAlert v-if="confirmDiscard" color="warning" variant="subtle" title="저장하지 않은 변경 내용이 있습니다" description="계속 편집하거나 변경 내용을 버리고 닫을 수 있습니다." class="mt-3" data-testid="memo-source-discard-warning" />
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton v-if="confirmDiscard" color="error" variant="outline" :disabled="saving || submitting" data-testid="memo-source-discard" @click="close">버리고 닫기</UButton>
        <UButton color="neutral" variant="outline" :disabled="saving || submitting" data-testid="memo-source-cancel" @click="confirmDiscard ? confirmDiscard = false : requestClose()">{{ confirmDiscard ? '계속 편집' : '취소' }}</UButton>
        <UButton :loading="saving || submitting" :disabled="!dirty" data-testid="memo-source-save" @click="submit">원문 저장</UButton>
      </div>
    </template>
  </UModal>
</template>
