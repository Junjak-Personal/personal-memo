<script setup lang="ts">
/**
 * 링크 넣기·고치기 (PC 말풍선) — nuxt-ui-templates/editor 의 LinkPopover 를 옮겼다.
 * 템플릿은 watch 로 선택을 따라갔는데, 여기서는 팝오버를 여는 순간 한 번 읽는다 — 그때만 필요하다.
 */
import type { Editor } from '@tiptap/vue-3'
import { applyLink, currentLink, removeLink } from './link'

const props = defineProps<{ editor: Editor }>()

const open = ref(false)
const url = ref('')

const active = computed(() => props.editor.isActive('link'))
const disabled = computed(() => !props.editor.isEditable || (props.editor.state.selection.empty && !active.value))

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
  url.value = ''
  open.value = false
}

function openLink() {
  if (url.value) window.open(url.value, '_blank', 'noopener,noreferrer')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  apply()
}
</script>

<template>
  <UPopover :open="open" :ui="{ content: 'p-0.5' }" @update:open="onOpen">
    <UTooltip text="링크">
      <UButton
        icon="i-material-symbols-link"
        color="neutral"
        active-color="primary"
        variant="ghost"
        active-variant="soft"
        size="sm"
        :active="active"
        :disabled="disabled"
        aria-label="링크"
      />
    </UTooltip>

    <template #content>
      <UInput
        v-model="url"
        autofocus
        name="url"
        type="url"
        variant="none"
        placeholder="링크 붙여넣기…"
        data-testid="memo-link-input"
        @keydown="onKeydown"
      >
        <div class="mr-0.5 flex items-center">
          <UButton icon="i-material-symbols-keyboard-return" variant="ghost" size="sm" :disabled="!url" aria-label="적용" @click="apply" />
          <USeparator orientation="vertical" class="mx-1 h-6" />
          <UButton icon="i-material-symbols-open-in-new" color="neutral" variant="ghost" size="sm" :disabled="!url" aria-label="새 창에서 열기" @click="openLink" />
          <UButton icon="i-material-symbols-delete-outline" color="neutral" variant="ghost" size="sm" :disabled="!active" aria-label="링크 지우기" @click="remove" />
        </div>
      </UInput>
    </template>
  </UPopover>
</template>
