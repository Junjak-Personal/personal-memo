<script setup lang="ts">
import ExtMemo from './_modules/ExtMemo.vue'
import ExtLayout from './_modules/ExtLayout.vue'

/** 외부 공개 메모 — 로그인 없이, 공개 항목만 있는 탐색 메뉴와 함께 연다. */
definePageMeta({ layout: false })

const route = useRoute()
</script>

<template>
  <ExtLayout>
    <ExtMemo :key="String(route.params.id)" :memo-id="String(route.params.id)" />
  </ExtLayout>
</template>
