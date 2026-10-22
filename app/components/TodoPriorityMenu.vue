<script setup lang="ts">
/**
 * 할 일 중요도 고르기 — 상·중·하. 「할 일」 화면의 각 줄과 메모 화면(할 일일 때 날짜 옆)에 쓴다.
 * 같은 날짜 안에서 상 → 중 → 하 순으로 놓인다 (compareOpenTodos).
 * 상은 강조색(primary) 옅은 바탕 — 빨강은 너무 튀었다 (2026-10-23 사용자 지적).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { TodoPriority } from '#shared/types/memo'
import { PRIORITY_LABEL, TODO_PRIORITIES } from '#shared/utils/todo'

const props = defineProps<{
  priority: TodoPriority
  disabled?: boolean
  size?: 'xs' | 'sm'
  testId: string
}>()

const emit = defineEmits<{ pick: [priority: TodoPriority] }>()

const items = computed<DropdownMenuItem[]>(() =>
  TODO_PRIORITIES.map((p) => ({
    label: PRIORITY_LABEL[p],
    type: 'checkbox',
    checked: props.priority === p,
    'data-testid': `${props.testId}-${p}`,
    onSelect: () => emit('pick', p),
  })),
)
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }" :disabled="disabled">
    <UButton
      :label="PRIORITY_LABEL[priority]"
      icon="i-material-symbols-flag-outline"
      :color="priority === 'high' ? 'primary' : 'neutral'"
      :variant="priority === 'medium' ? 'outline' : 'soft'"
      :size="size ?? 'xs'"
      :disabled="disabled"
      :aria-label="`중요도 ${PRIORITY_LABEL[priority]}`"
      :data-testid="testId"
    />
  </UDropdownMenu>
</template>
