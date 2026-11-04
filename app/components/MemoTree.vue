<script setup lang="ts">
import type { TreeItem, TreeSlots } from '@nuxt/ui'

defineProps<{ items: TreeItem[]; modelValue?: TreeItem }>()
defineSlots<Pick<TreeSlots<TreeItem[]>, 'item'>>()
const expanded = defineModel<string[]>('expanded', { default: () => [] })
</script>

<template>
  <UTree
    v-model:expanded="expanded"
    :items="items"
    :model-value="modelValue"
    :get-key="(item: TreeItem) => String(item.value)"
    :as="{ link: 'div' }"
    :ui="{ link: 'min-h-11 py-0 lg:min-h-0 lg:py-1.5', listWithChildren: 'border-s border-default animate-tree-open' }"
    color="neutral"
  >
    <template #item="slotProps"><slot name="item" v-bind="slotProps" /></template>
  </UTree>
</template>
