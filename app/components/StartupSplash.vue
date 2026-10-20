<script setup lang="ts">
const { phase, reveal } = useStartupLoading()
const visible = computed(() => phase.value === 'loading' || phase.value === 'slow' || phase.value === 'failed')
function retry() { window.location.reload() }
</script>

<template>
  <div v-if="visible" class="memo-startup" role="status" aria-live="polite" data-testid="startup-splash">
    <div class="memo-startup-inner">
      <img src="/memo-logo.png" width="48" height="48" alt="" />
      <strong>memo</strong>
      <span v-if="phase === 'loading'" class="memo-startup-spinner" aria-hidden="true" />
      <p>{{ phase === 'failed' ? '첫 화면을 준비하지 못했습니다' : phase === 'slow' ? '화면 준비가 평소보다 오래 걸리고 있습니다' : '메모를 준비하고 있어요' }}</p>
      <div v-if="phase !== 'loading'" class="memo-startup-actions">
        <button type="button" @click="retry">다시 시도</button>
        <button v-if="phase === 'slow'" type="button" @click="reveal">웹 화면 보기</button>
      </div>
    </div>
  </div>
</template>
