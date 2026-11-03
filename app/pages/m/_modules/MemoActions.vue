<script setup lang="ts">
/**
 * 메모 메뉴 — 할 일로 두기/해제, 외부 공개, 폴더 이동, 휴지통으로.
 * 외부 공개 중이면 메뉴 옆에 「공개 중」 버튼을 늘 보여 준다 — 누르면 링크를 복사한다 (usePublicMemo).
 * 할 일로 두면 frontmatter 에 `done: false` 가 붙고 「할 일」 폴더로 옮겨진다. 해제하면 키를 지우고 최상위로 옮긴다 (useTodo).
 * 중요도는 메뉴가 아니라 날짜 옆 버튼에서 고른다 (MemoDocument, 2026-10-23).
 * 폴더 이동은 대기열에 넣는다 — 사이드바엔 바로 보이고 파일은 3초 뒤 옮겨진다 (useStructureQueue).
 * 휴지통은 바로 한다 — 고친 게 남아 있으면 먼저 저장한다.
 * 삭제는 휴지통으로 옮기는 것이라 확인창 대신 「되돌리기」 알림을 준다.
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import MemoHistoryDialog from './MemoHistoryDialog.vue'
import MemoSaveTemplateDialog from './MemoSaveTemplateDialog.vue'

const props = defineProps<{
  memoId: () => string
  version: () => string
  flush: () => Promise<boolean>
  title: () => string
  folder: string
  hideMenu?: boolean
}>()

const toast = useToast()
const { moveToTrash, notifyMoved } = useMemoTrashActions()
const activeMemo = useActiveMemo()
const queue = useStructureQueue()
const todo = useTodo()
const share = usePublicMemo()
const navigation = useMemoNavigation()
const historyDialog = useTemplateRef<{ show: () => Promise<void> }>('historyDialog')
const saveTemplateDialog = useTemplateRef<{ show: () => void }>('saveTemplateDialog')

const moveOpen = ref(false)
const removing = ref(false)

/** 트리에 아직 없으면(방금 만든 메모) null — 일반 메모로 본다 */
const done = computed(() => todo.find(props.memoId())?.done ?? null)
const isPublic = computed(() => share.isPublic(props.memoId()))

const items = computed<DropdownMenuItem[][]>(() => [
  [
    { label: navigation.isFavorite(props.memoId()) ? '즐겨찾기 해제' : '즐겨찾기에 추가', icon: navigation.isFavorite(props.memoId()) ? 'i-material-symbols-star' : 'i-material-symbols-star-outline', disabled: navigation.pending.value, onSelect: toggleFavorite },
    { label: '수정 이력', icon: 'i-material-symbols-history', onSelect: () => void historyDialog.value?.show() },
    { label: '템플릿으로 저장', icon: 'i-material-symbols-note-stack-add-outline', onSelect: () => saveTemplateDialog.value?.show() },
  ],
  done.value === null
    ? [{ label: '할 일로 두기', icon: 'i-material-symbols-add-task', onSelect: () => void todo.setDone(props.memoId(), false) }]
    : [{ label: '할 일 해제', icon: 'i-material-symbols-remove-done', onSelect: () => void todo.setDone(props.memoId(), null) }],
  isPublic.value
    ? [
        { label: '공개 링크 복사', icon: 'i-material-symbols-link', onSelect: () => void share.copyLink(props.memoId()) },
        { label: share.isInherited(props.memoId()) ? '폴더에서 공개 중' : '외부 공개 끄기', icon: 'i-material-symbols-public-off', disabled: share.isInherited(props.memoId()), onSelect: () => void share.setPublic(props.memoId(), false) },
      ]
    : [{ label: '외부 공개', icon: 'i-material-symbols-public', onSelect: () => void share.setPublic(props.memoId(), true) }],
  [{ label: '폴더 이동', icon: 'i-material-symbols-drive-file-move-outline', onSelect: () => (moveOpen.value = true) }],
  [{ label: '휴지통으로', icon: 'i-material-symbols-delete-outline', color: 'error', onSelect: remove }],
])

async function toggleFavorite() {
  if (!(await navigation.toggleFavorite(props.memoId()))) {
    toast.add({ color: 'error', title: navigation.error.value ?? '즐겨찾기를 저장하지 못했습니다' })
  }
}

function move(folder: string) {
  queue.push({ kind: 'moveMemo', id: props.memoId(), title: props.title(), folder })
  moveOpen.value = false
}

async function remove() {
  if (removing.value) return
  // 대기 중인 옮기기를 먼저 반영한다 — 이 메모를 옮기는 변경이 남은 채 지우면 그 변경이 실패한다
  if (!(await queue.apply())) return
  if (!(await activeMemo.flush())) {
    toast.add({ color: 'error', title: '저장하지 못해서 지우지 않았습니다', description: '저장 상태를 먼저 확인하세요.' })
    return
  }
  removing.value = true
  try {
    const trashPath = await moveToTrash(props.memoId())
    notifyMoved(trashPath)
    await navigateTo('/')
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '지우지 못했습니다') })
  } finally {
    removing.value = false
  }
}

</script>

<template>
  <UTooltip v-if="isPublic && !hideMenu" text="공개 링크 복사">
    <UButton
      icon="i-material-symbols-public"
      color="primary"
      variant="outline"
      class="size-11 shrink-0 justify-center lg:h-8 lg:w-auto"
      aria-label="외부 공개 중 — 공개 링크 복사"
      data-testid="memo-public-badge"
      @click="share.copyLink(props.memoId())"
    >
      <span class="hidden lg:inline">공개 중</span>
    </UButton>
  </UTooltip>

  <slot />

  <UDropdownMenu v-if="!hideMenu" :items="items" :content="{ align: 'end' }">
    <UTooltip text="메모 메뉴">
      <UButton icon="i-material-symbols-more-horiz" color="neutral" variant="ghost" class="size-11 shrink-0 justify-center lg:size-8" aria-label="메모 메뉴" data-testid="memo-actions-button" />
    </UTooltip>
  </UDropdownMenu>

  <FolderPickDialog v-model:open="moveOpen" title="폴더 이동" :current="folder" @pick="move" />
  <MemoHistoryDialog ref="historyDialog" :memo-id="props.memoId" :version="props.version" :flush="props.flush" />
  <MemoSaveTemplateDialog ref="saveTemplateDialog" :memo-id="props.memoId" :version="props.version" :flush="props.flush" :title="props.title" />
</template>
