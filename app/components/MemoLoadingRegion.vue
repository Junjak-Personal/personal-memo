<script setup lang="ts">
const props = withDefaults(defineProps<{ loading: boolean; label: string; overlay?: boolean; preserveHeight?: boolean }>(), { overlay: true, preserveHeight: true })
const region = useTemplateRef<HTMLElement>('region')
const heldHeight = ref<number | null>(null)
// 로딩으로 slot이 비기 전 실제 높이만 유지하고, 완료하면 자연스러운 콘텐츠 크기로 돌아간다.
watch(() => props.loading, loading => {
  heldHeight.value = loading && props.preserveHeight ? (region.value?.getBoundingClientRect().height || null) : null
}, { flush: 'sync' })
</script>

<template>
  <div ref="region" class="relative min-h-11" :style="heldHeight ? { minHeight: `${heldHeight}px` } : undefined">
    <div :aria-busy="loading" class="h-full min-h-0">
      <slot />
    </div>
    <div v-if="loading && overlay" class="pointer-events-none absolute inset-0 z-10 flex items-start justify-end p-2" aria-hidden="true" data-testid="memo-loading-overlay">
      <span class="flex size-7 items-center justify-center rounded-full bg-default/90 ring-1 ring-default">
        <UIcon name="i-material-symbols-progress-activity" class="size-4 animate-spin motion-reduce:animate-none" />
      </span>
    </div>
    <p role="status" aria-live="polite" class="sr-only">{{ loading ? label : '' }}</p>
  </div>
</template>
