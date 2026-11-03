<script setup lang="ts">
import ExtFolder from '../_modules/ExtFolder.vue'
import ExtLayout from '../_modules/ExtLayout.vue'

definePageMeta({ layout: false })
const route = useRoute()
</script>

<template>
  <ExtLayout>
    <ExtFolder :key="String(route.params.id)" :folder-id="String(route.params.id)" />
  </ExtLayout>
</template>
