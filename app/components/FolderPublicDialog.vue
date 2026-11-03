<script setup lang="ts">
import type { FolderNode } from '#shared/types/memo'

const { tree, refresh } = useMemoTree()
const queue = useStructureQueue()
const activeMemo = useActiveMemo()
const toast = useToast()
const target = ref<{ path: string; value: boolean } | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
let sequence = 0

function find(nodes: FolderNode[], path: string): FolderNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const child = find(node.children, path)
    if (child) return child
  }
}

const folder = computed(() => target.value ? find(tree.value?.folders ?? [], target.value.path) : undefined)

async function show(path: string, value: boolean) {
  if (!path || busy.value) return
  if (!(await queue.apply())) return
  target.value = { path, value }
  error.value = null
  sequence++
}

function close(open: boolean) {
  if (!open && !busy.value) {
    target.value = null
    sequence++
  }
}

async function submit() {
  if (!target.value || busy.value) return
  const request = { ...target.value }
  const token = sequence
  busy.value = true
  error.value = null
  let saved = false
  try {
    if (!(await activeMemo.flush())) {
      error.value = '편집 중인 메모를 저장하지 못해 공개 설정을 바꾸지 않았습니다.'
      return
    }
    await $fetch<FolderNode>('/api/folders/public', { method: 'PUT', body: { path: request.path, public: request.value } })
    saved = true
    await refresh()
    if (token !== sequence) return
    target.value = null
    toast.add({
      title: request.value ? '폴더를 외부 공개했습니다' : '폴더의 외부 공개를 껐습니다',
      description: request.value ? '하위 폴더와 메모도 공개됩니다.' : '개별 공개한 폴더와 메모의 공개 상태는 유지됩니다.',
    })
  } catch (e) {
    if (token === sequence) error.value = saved
      ? '공개 설정은 변경됐지만 목록을 새로고치지 못했습니다. 화면을 새로고침해 상태를 확인하세요.'
      : apiMessage(e, '폴더 공개 설정을 바꾸지 못했습니다')
  } finally {
    busy.value = false
  }
}

onBeforeUnmount(() => sequence++)
defineExpose({ show })
</script>

<template>
  <UModal
    :open="target !== null"
    :title="target?.value ? '폴더 외부 공개' : '폴더 외부 공개 끄기'"
    :description="folder?.name ?? target?.path ?? ''"
    :dismissible="!busy"
    :close="!busy"
    @update:open="close"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert v-if="error" :title="error" color="error" variant="subtle" data-testid="folder-public-error" />
        <template v-if="target?.value">
          <p class="text-sm text-default">링크를 아는 사람은 로그인 없이 이 폴더와 모든 하위 폴더·메모를 읽을 수 있습니다.</p>
          <p class="text-sm text-muted">나중에 추가하거나 이 폴더로 옮기는 메모도 자동으로 공개됩니다.</p>
          <p class="text-sm text-muted">공개 링크의 왼쪽 목록에서는 다른 공개 폴더와 메모도 함께 볼 수 있습니다.</p>
        </template>
        <template v-else>
          <p class="text-sm text-default">이 폴더의 공개 설정을 끕니다. 폴더에서 공개 상태를 물려받은 하위 항목도 비공개로 돌아갑니다.</p>
          <p class="text-sm text-muted">별도로 공개한 하위 폴더와 메모는 계속 공개됩니다.</p>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" :disabled="busy" data-testid="folder-public-cancel" @click="close(false)">취소</UButton>
        <UButton :loading="busy" data-testid="folder-public-submit" @click="submit">{{ target?.value ? '하위 항목까지 공개' : '공개 끄기' }}</UButton>
      </div>
    </template>
  </UModal>
</template>
