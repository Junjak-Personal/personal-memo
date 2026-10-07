<script setup lang="ts">
/** 옮길 폴더 고르기 — 메모 이동과 폴더 이동(폰에서는 끌어 놓기 대신 이것)이 같이 쓴다 */
import type { FolderNode } from '#shared/types/memo'

const props = defineProps<{
  title: string
  /** 지금 있는 폴더 — 처음 골라져 있고, 그대로면 옮기기를 막는다 */
  current: string
  /** 폴더를 옮길 때 그 폴더 자신 — 자기와 자기 하위는 고를 수 없다 */
  exclude?: string
  busy?: boolean
}>()

const emit = defineEmits<{ pick: [folder: string] }>()

const open = defineModel<boolean>('open', { required: true })

// 대기 중인 옮기기까지 얹은 트리 — 사이드바에 보이는 것과 같은 목록에서 고른다
const { view: tree } = useStructureQueue()

const target = ref(props.current)

const options = computed(() =>
  [{ label: '최상위', value: '' }, ...flatten(tree.value?.folders ?? [])].filter(
    (o) => !props.exclude || (o.value !== props.exclude && !o.value.startsWith(`${props.exclude}/`)),
  ),
)

function flatten(folders: FolderNode[]): { label: string; value: string }[] {
  return folders.flatMap((f) => [{ label: f.path, value: f.path }, ...flatten(f.children)])
}

function onOpen(value: boolean) {
  if (value) target.value = props.current
  open.value = value
}
</script>

<template>
  <UModal :open="open" :title="title" @update:open="onOpen">
    <template #body>
      <USelect v-model="target" :items="options" class="w-full" data-testid="folder-pick-select" />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="open = false">취소</UButton>
        <UButton :loading="busy" :disabled="target === current" data-testid="folder-pick-confirm" @click="emit('pick', target)">옮기기</UButton>
      </div>
    </template>
  </UModal>
</template>
