<script setup lang="ts">
import { ko } from '@nuxt/ui/locale'
</script>

<template>
  <UApp :locale="ko">
    <StartupSplash />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
