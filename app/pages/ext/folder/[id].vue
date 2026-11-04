<script setup lang="ts">
import ExtFolder from '../_modules/ExtFolder.vue'

definePageMeta({ layout: 'ext' })
const route = useRoute()
</script>

<template>
  <ExtFolder :key="String(route.params.id)" :folder-id="String(route.params.id)" />
</template>
