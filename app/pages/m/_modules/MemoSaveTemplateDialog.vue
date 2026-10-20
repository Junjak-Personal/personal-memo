<script setup lang="ts">
const props = defineProps<{
  memoId: () => string
  version: () => string
  flush: () => Promise<boolean>
  title: () => string
}>()
const dialog = useSaveMemoTemplate(props)
const { open, name, busy, error } = dialog
const toast = useToast()
async function save() {
  if (await dialog.save()) toast.add({ title: '내 템플릿에 저장했습니다' })
}
function onOpen(value: boolean) {
  if (!value && !busy.value) dialog.close()
}
defineExpose({ show: dialog.show })
</script>

<template>
  <UModal :open="open" title="템플릿으로 저장" description="현재 메모를 먼저 저장한 뒤 제목·본문·체크리스트·태그를 템플릿으로 보관합니다." :dismissible="!busy" :close="!busy" @update:open="onOpen">
    <template #body>
      <form id="memo-save-template" class="space-y-3" @submit.prevent="save">
        <label for="memo-save-template-name" class="block text-sm">템플릿 이름</label>
        <UInput id="memo-save-template-name" v-model="name" :maxlength="200" :disabled="busy" autofocus class="w-full" :ui="{ base: 'min-h-11' }" />
        <UAlert v-if="error" :title="error" color="error" variant="subtle" data-testid="memo-save-template-error" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" class="min-h-11" :disabled="busy" @click="dialog.close">취소</UButton>
        <UButton type="submit" form="memo-save-template" class="min-h-11" :loading="busy" :disabled="!name.trim() || name.trim().length > 200">템플릿 저장</UButton>
      </div>
    </template>
  </UModal>
</template>
