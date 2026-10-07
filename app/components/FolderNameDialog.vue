<script setup lang="ts">
/** 폴더 이름 받기 — 새 폴더와 이름 바꾸기가 같이 쓴다 */
const props = defineProps<{ title: string; initial?: string; submitLabel: string; busy?: boolean }>()

const emit = defineEmits<{ submit: [name: string] }>()

const open = defineModel<boolean>('open', { required: true })

const name = ref(props.initial ?? '')

function onOpen(value: boolean) {
  if (value) name.value = props.initial ?? ''
  open.value = value
}

function submit() {
  const trimmed = name.value.trim()
  if (trimmed) emit('submit', trimmed)
}
</script>

<template>
  <UModal :open="open" :title="title" @update:open="onOpen">
    <template #body>
      <form @submit.prevent="submit">
        <UInput v-model="name" placeholder="폴더 이름" autofocus class="w-full" data-testid="folder-name-input" />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="open = false">취소</UButton>
        <UButton :loading="busy" :disabled="!name.trim()" data-testid="folder-name-submit" @click="submit">{{ submitLabel }}</UButton>
      </div>
    </template>
  </UModal>
</template>
