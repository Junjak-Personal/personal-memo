<script setup lang="ts">
import ExtMemo from './_modules/ExtMemo.vue'

/** 외부 공개 메모 — 로그인 없이, 사이드바 없이 (설계문서 §11.2) */
definePageMeta({ layout: false })

const route = useRoute()
</script>

<template>
  <ExtMemo :key="String(route.params.id)" :memo-id="String(route.params.id)" />
</template>
