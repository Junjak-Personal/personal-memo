<script setup lang="ts">
/** 링크 넣기 (폰). 네이티브 툴바의 링크 버튼이 연다 — 말풍선이 없는 화면이라 창으로 받는다 */
import type { Editor } from '@tiptap/vue-3'
import { applyLink, currentLink, removeLink } from './link'

const props = defineProps<{ editor: Editor }>()

const open = defineModel<boolean>('open', { required: true })

const url = ref('')

const active = computed(() => props.editor.isActive('link'))

function onOpen(value: boolean) {
  if (value) url.value = currentLink(props.editor)
  open.value = value
}

function apply() {
  applyLink(props.editor, url.value)
  open.value = false
}

function remove() {
  removeLink(props.editor)
  open.value = false
}
</script>

<template>
  <UModal :open="open" title="링크" @update:open="onOpen">
    <template #body>
      <form @submit.prevent="apply">
        <UInput v-model="url" type="url" placeholder="https://" autofocus class="w-full" data-testid="memo-link-dialog-input" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-between gap-2">
        <UButton v-if="active" color="error" variant="outline" @click="remove">링크 지우기</UButton>
        <div class="ml-auto flex gap-2">
          <UButton color="neutral" variant="outline" @click="open = false">취소</UButton>
          <UButton :disabled="!url" data-testid="memo-link-dialog-apply" @click="apply">적용</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
