<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'

defineProps<{ item: TreeItem; expanded: boolean; toggleTestId: string }>()
defineEmits<{ toggle: [] }>()
</script>

<template>
  <div class="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1">
    <slot name="leading"><UIcon :name="String(item.icon)" class="size-5 shrink-0" /></slot>
    <span class="truncate" :class="item.done === true && 'text-muted line-through'">{{ item.label }}</span>
    <slot name="after-label" />
    <span class="ms-auto flex shrink-0 items-center">
      <slot name="actions" />
      <UButton
        v-if="item.kind === 'folder'"
        :icon="expanded ? 'i-material-symbols-keyboard-arrow-up' : 'i-material-symbols-keyboard-arrow-down'"
        color="neutral"
        variant="ghost"
        size="xs"
        class="size-9 justify-center lg:size-6"
        :aria-label="expanded ? '폴더 접기' : '폴더 펼치기'"
        :aria-expanded="expanded"
        :data-testid="toggleTestId"
        @pointerdown.stop
        @click.stop="$emit('toggle')"
      />
    </span>
  </div>
</template>
