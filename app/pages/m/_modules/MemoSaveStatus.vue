<script setup lang="ts">
/**
 * 저장 상태. 🔴 폭을 고정한다 — 「저장됨」 ↔ 「저장 중…」 처럼 글자 수가 바뀌면 위 줄 가운데의 툴바가
 * 좌우로 밀렸다 (2026-10-07 사용자 지적). 실패했을 때도 버튼을 따로 붙이지 않고 이 자리 자체를 눌러 다시 시도한다.
 */
import type { SaveState } from './useMemoAutosave'

const props = defineProps<{ state: SaveState }>()

const emit = defineEmits<{ retry: [] }>()

const view = computed(() => {
  switch (props.state.status) {
    case 'saved':
      return { icon: 'i-material-symbols-cloud-done-outline', text: '저장됨', class: 'text-muted' }
    case 'dirty':
      return { icon: 'i-material-symbols-edit-outline', text: '고치는 중', class: 'text-muted' }
    case 'saving':
      return { icon: 'i-material-symbols-progress-activity', text: '저장 중…', class: 'text-muted' }
    case 'error':
      return { icon: 'i-material-symbols-cloud-off-outline', text: '저장 실패', class: 'text-error' }
    case 'offline':
      return { icon: 'i-material-symbols-cloud-off-outline', text: '기기에 보관', class: 'text-warning' }
    case 'conflict':
      return { icon: 'i-material-symbols-warning-outline', text: '충돌', class: 'text-warning' }
    case 'format':
      return { icon: 'i-material-symbols-warning-outline', text: '저장 보류', class: 'text-warning' }
  }
})

const failed = computed(() => props.state.status === 'error')
const message = computed(() => {
  if (props.state.status === 'error') return `${props.state.message} — 눌러서 다시 시도`
  if (props.state.status === 'offline') return '서버에 닿지 않아 이 기기에 보관했습니다. 연결되면 저장합니다'
  return undefined
})
</script>

<template>
  <component
    :is="failed ? 'button' : 'div'"
    :type="failed ? 'button' : undefined"
    class="flex size-11 shrink-0 items-center justify-center gap-1 rounded-md text-xs lg:h-8 lg:w-24 lg:justify-end"
    :class="[view.class, failed && 'cursor-pointer border border-error/50 px-1.5 py-0.5 hover:bg-error/10']"
    :title="message"
    :aria-label="message"
    :data-state="state.status"
    data-testid="memo-save-status"
    @click="failed && emit('retry')"
  >
    <UIcon :name="view.icon" class="size-4 shrink-0" :class="state.status === 'saving' && 'animate-spin'" />
    <span class="hidden truncate lg:inline">{{ view.text }}</span>
  </component>
</template>
