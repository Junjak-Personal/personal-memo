<script setup lang="ts">
import { isNavigationFailure } from 'vue-router'
import type { FolderNode, Memo } from '#shared/types/memo'

const active = useActiveMemo()
const queue = useStructureQueue()
const { refresh, ensure } = useMemoTree()
const toast = useToast()
const templates = useMemoTemplates({ flush: async () => await queue.apply() && await active.flush() })
const { open, loading, selecting, busy, error, selected, selectedReady, name, confirming, created } = templates
const folder = ref('/')
const navigating = ref(false)
const locked = computed(() => busy.value || navigating.value)
const selectionLocked = computed(() => locked.value || loading.value || selecting.value || !selectedReady.value)
const folders = computed(() => [{ label: '최상위', value: '/' }, ...flatten(queue.view.value?.folders ?? [])])
function flatten(nodes: FolderNode[]): { label: string; value: string }[] {
  return nodes.flatMap(node => [{ label: node.path, value: node.path }, ...flatten(node.children)])
}
async function show(initialFolder = '') {
  if (locked.value) return
  folder.value = initialFolder || '/'
  void ensure()
  await templates.show()
}
function onOpen(value: boolean) {
  if (!value && !locked.value) templates.close()
}
async function openCreated(memo: Memo) {
  if (navigating.value || !templates.current()) return
  const token = templates.token()
  navigating.value = true
  try {
    await refresh()
    if (!templates.current(token)) return
    const result = await navigateTo(memoPath(memo.id))
    if (!templates.current(token)) return
    if (result === false || isNavigationFailure(result)) throw new Error('navigation-cancelled')
    templates.close()
    toast.add({ title: '템플릿으로 새 메모를 만들었습니다' })
  } catch {
    if (templates.current(token)) error.value = '새 메모는 만들어졌지만 열지 못했습니다. 메모 목록에서 확인하거나 아래 버튼으로 여세요.'
  } finally {
    navigating.value = false
  }
}
async function create() {
  if (locked.value) return
  const memo = await templates.create(folder.value === '/' ? '' : folder.value)
  if (memo) await openCreated(memo)
}
defineExpose({ show })
</script>

<template>
  <UModal :open="open" title="내 템플릿" description="반복해서 쓰는 메모를 보관하고 새 메모로 만듭니다." :dismissible="!locked" :close="!locked" :ui="{ content: 'sm:max-w-4xl', body: 'min-h-0' }" @update:open="onOpen">
    <template #body>
      <UAlert v-if="error" :title="error" color="error" variant="subtle" class="mb-4" data-testid="memo-templates-error" />
      <UButton v-if="error && !created" color="neutral" variant="outline" class="mb-4 min-h-11" :disabled="locked" data-testid="memo-templates-retry" @click="templates.show">목록 다시 불러오기</UButton>
      <MemoLoadingRegion :loading="loading && !selecting" label="템플릿 목록을 불러오는 중…">
        <div v-if="templates.templates.value.length" class="grid min-h-0 gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <nav aria-label="저장된 템플릿" class="flex max-h-36 flex-col gap-1 overflow-y-auto sm:max-h-[50dvh]">
            <button v-for="item in templates.templates.value" :key="item.id" type="button" class="min-h-11 rounded-md border border-default px-3 py-2 text-left text-sm break-words hover:bg-elevated" :class="selected?.id === item.id && 'bg-elevated ring-1 ring-primary'" :aria-pressed="selected?.id === item.id" :disabled="locked" data-testid="memo-template-item" @click="templates.select(item.id)">{{ item.name }}</button>
          </nav>
          <MemoLoadingRegion :loading="selecting" label="템플릿을 불러오는 중…" class="min-w-0">
            <div v-if="selected" class="space-y-3">
              <form class="flex gap-2" @submit.prevent="templates.rename">
                <label for="memo-template-name" class="sr-only">템플릿 이름</label>
                <UInput id="memo-template-name" v-model="name" :maxlength="200" :disabled="selectionLocked" class="min-w-0 flex-1" :ui="{ base: 'min-h-11' }" />
                <UButton type="submit" color="neutral" variant="outline" class="min-h-11" :disabled="selectionLocked || !name.trim() || name.trim() === selected.name">이름 변경</UButton>
              </form>
              <article class="max-h-[35dvh] overflow-auto rounded-md border border-default p-4 sm:max-h-[40dvh]" data-testid="memo-template-preview">
                <h3 class="mb-2 text-lg font-semibold break-words">{{ selected.title || '제목 없음' }}</h3>
                <p v-if="selected.tags.length" class="mb-3 text-xs text-muted">{{ selected.tags.map(tag => `#${tag}`).join(' ') }}</p>
                <p class="mb-2 text-xs text-dimmed">본문 원문</p>
                <pre class="font-sans text-sm whitespace-pre-wrap break-words">{{ selected.content || '(빈 메모)' }}</pre>
              </article>
              <label for="memo-template-folder" class="block text-sm">새 메모를 만들 폴더</label>
              <USelect id="memo-template-folder" v-model="folder" :items="folders" :disabled="selectionLocked || !!created" class="w-full" :ui="{ base: 'min-h-11' }" />
              <p class="text-xs text-dimmed">제목·본문·체크리스트·태그를 복사합니다. 날짜·할 일·공개 상태는 복사하지 않습니다.</p>
              <UButton color="error" variant="outline" class="min-h-11" :disabled="selectionLocked" @click="confirming = !confirming">템플릿 삭제…</UButton>
              <UAlert v-if="confirming" color="warning" variant="subtle" title="이 템플릿을 삭제할까요?" description="템플릿만 삭제합니다. 원본 메모와 이 템플릿으로 만든 메모는 유지됩니다." />
            </div>
          </MemoLoadingRegion>
        </div>
        <p v-else-if="!loading && !error" class="py-8 text-center text-sm text-muted">아직 템플릿이 없습니다. 메모 메뉴에서 ‘템플릿으로 저장’을 선택하세요.</p>
      </MemoLoadingRegion>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton color="neutral" variant="outline" class="min-h-11" :disabled="locked" @click="confirming ? confirming = false : templates.close()">{{ confirming ? '취소' : '닫기' }}</UButton>
        <UButton v-if="confirming" color="error" class="min-h-11" :loading="busy" :disabled="selectionLocked" @click="templates.remove">템플릿 삭제</UButton>
        <UButton v-else-if="created" class="min-h-11" :loading="navigating" @click="openCreated(created)">만든 메모 열기</UButton>
        <UButton v-else class="min-h-11" :loading="locked" :disabled="selectionLocked" data-testid="memo-template-create" @click="create">새 메모 만들기</UButton>
      </div>
    </template>
  </UModal>
</template>
