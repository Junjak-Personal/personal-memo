<script setup lang="ts">
/**
 * 메모 한 장 — 위 툴바 + 가운데 문서 (설계문서 §7.4, 에디터 템플릿과 같은 배치).
 * 에디터 기능은 nuxt-ui-templates/editor 에 있는 것 전부에서 멘션·AI·공동 편집을 뺀 것이다 (§7.3.1).
 * 저장은 useMemoAutosave, 폰의 네이티브 툴바는 useNativeBridge 가 맡는다.
 */
import type { Editor as CoreEditor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'
import type { Editor, JSONContent } from '@tiptap/vue-3'
import type { RouteLocationNormalized } from 'vue-router'
import type { Memo } from '#shared/types/memo'
import { originalOfDisplay, toDisplaySrc, toOriginalSrc, toStoredSrc } from '#shared/utils/asset-path'
import { cleanTags, MAX_TAG_LENGTH, MAX_TAGS, sameTags, TAG_DELIMITER } from '#shared/utils/tags'
import { emojiItems } from '~/utils/editor-emoji'
import { memoExtensions } from '~/utils/editor-extensions'
import { prepareImage, type PreparedImage } from '~/utils/image-resize'
import { type MemoDraft, removeDraft } from '~/utils/memo-drafts'
import { ImageUpload } from './editor/ImageUploadExtension'
import { blockHandleOptions, blockHandleUi } from './editor/drag-handle-options'
import MobileBlockMove from './editor/MobileBlockMove.vue'
import {
  bubbleToolbarItems,
  customHandlers,
  dragHandleItems,
  imageToolbarItems,
  suggestionItems,
  tableToolbarItems,
  toolbarItems,
} from './editor/items'
import LinkDialog from './editor/LinkDialog.vue'
import LinkPopover from './editor/LinkPopover.vue'
import MemoActions from './MemoActions.vue'
import MemoCalendarSyncBadge from './MemoCalendarSyncBadge.vue'
import MemoSaveStatus from './MemoSaveStatus.vue'
import { canonicalMarkdown, shouldSaveMarkdown, type SaveState, useMemoAutosave } from './useMemoAutosave'
import { useNativeBridge } from './useNativeBridge'

interface MenuContext {
  // 말풍선 툴바의 shouldShow 는 vue-3 Editor 가 아니라 core Editor 를 넘긴다
  editor: CoreEditor
  view: EditorView
  state: EditorState
}

const props = defineProps<{ memoId: string }>()

const emit = defineEmits<{ renamed: [from: string, to: string] }>()

const toast = useToast()
const { refresh: refreshTree } = useMemoTree()
const activeMemo = useActiveMemo()
const mobileMenu = useMobileMenuNavigation()
// await 뒤에 현재 route/id를 읽으면 새 요청으로 바뀔 수 있다. 이 문서를 만든 요청을 미리 고정한다.
const openingMemoId = props.memoId
const menuSequence = mobileMenu.pending.value?.memoId === openingMemoId ? mobileMenu.pending.value.sequence : null
const calendarSync = useCalendarSyncStatus()
const todo = useTodo()

const { data: memo, error } = await useAsyncData(
  /*
   * tick 을 넣는다 — 같은 메모를 다시 세울 때([id].vue) 새 화면이 붙기 전까지 이전 화면이 떠 있어서, key 가 같으면
   * 이전 화면의 데이터를 나눠 쓰고 새로 받지 않는다 (폴더를 옮긴 뒤에도 옛 폴더·이미지 주소가 나왔다 — 2026-10-16 실측)
   */
  `memo-${props.memoId}#${activeMemo.tick.value}`,
  () => $fetch<Memo>(`/api/memos/${encodeURIComponent(props.memoId)}`),
  // 열 때마다 서버에서 새로 받는다 — 옮기거나 밖에서 고친 뒤 다시 세울 때 옛 내용이 나오면 안 된다
  { getCachedData: () => undefined },
)

const rootRef = useTemplateRef('rootRef')
// 타입을 적는다 — 템플릿이 autosave 를 쓰고 autosave 가 editorRef 를 써서 추론이 순환한다
const editorRef = useTemplateRef<{ editor?: Editor }>('editorRef')
/** 입력칸의 제목 */
const title = ref(memo.value?.title ?? '')
/**
 * 저장에 싣는 제목. 제목이 바뀌면 파일 이름도 바뀌므로, 치는 도중의 「회」「회의」 마다 파일 이름이 바뀌지 않게
 * 입력이 5초 멈추거나 제목 칸을 벗어날 때만 확정한다 (본문은 1초 — 2026-10-07 사용자 요청).
 */
const savedTitle = ref(memo.value?.title ?? '')
const content = ref(memo.value?.content ?? '')
const date = ref(memo.value?.date ?? null)
const dateEnd = ref(memo.value?.dateEnd ?? null)
const tags = ref<string[]>(memo.value?.tags ?? [])
const currentFolder = ref(memo.value?.folder ?? '')
const selectedNode = ref<{ node: JSONContent | null; pos: number }>()
const blockMoveActive = ref(false)
const linkOpen = ref(false)
/** 원본 보기 창에 띄울 원본 주소 */
const originalUrl = ref<string | null>(null)
/** 원본 보기 — 화면에 맞춤 / 원래 크기 (확대가 막혀 있어서 원래 크기로 보고 밀어서 본다) */
const originalFit = ref(true)

const folder = memo.value?.folder ?? ''
/** 터치 화면에서는 글자 말풍선 툴바를 끈다 — iOS 복사/붙여넣기 메뉴와 같은 자리에 겹친다 (설계문서 §7.3) */
const coarsePointer = window.matchMedia('(pointer: coarse)').matches
const autosave = memo.value
  ? useMemoAutosave({
      memo: memo.value,
      read: () => ({ title: savedTitle.value, content: content.value, date: date.value, dateEnd: dateEnd.value, tags: tags.value }),
      normalize: (markdown) => {
        const manager = editorRef.value?.editor?.markdown
        return manager ? manager.serialize(manager.parse(markdown)) : markdown
      },
      onSaved,
    })
  : null
const bridge = useNativeBridge(() => editorRef.value?.editor, () => (linkOpen.value = true))
/** 제목을 확정하지 않은 채면 「저장됨」 대신 「고치는 중」 */
const saveState = computed<SaveState>(() => {
  const state = autosave?.state.value ?? { status: 'saved' }
  return state.status === 'saved' && title.value !== savedTitle.value ? { status: 'dirty' } : state
})
if (autosave) activeMemo.register({ id: autosave.currentId, folder: () => currentFolder.value, flush: flushAll })
/** 할 일 체크 — 사이드바 트리가 원본이다(useTodo). 이 메모가 할 일이 아니면 null */
const todoDone = computed(() => (autosave ? (todo.find(autosave.currentId())?.done ?? null) : null))
/**
 * 이 기기에 저장하지 못한 수정이 남아 있으면 (오프라인 보호 — memo-drafts):
 * - 서버가 그 뒤로 바뀌지 않았으면 바로 되살려 저장한다
 * - 바뀌었거나 이미 충돌로 거절됐으면 사람이 고른다 (조용히 덮지 않는다)
 */
const draftOnOpen = autosave?.pendingDraft() ?? null
const restoredDraft = !!draftOnOpen && !draftOnOpen.conflict && draftOnOpen.baseVersion === memo.value?.version
const staleDraft = ref<MemoDraft | null>(draftOnOpen && !restoredDraft ? draftOnOpen : null)
if (draftOnOpen && restoredDraft) applyDraft(draftOnOpen)
const extensions = memoExtensions(
  {
    toDisplay: (src: string) => toDisplaySrc(folder, src),
    toStored: (src: string) => toStoredSrc(folder, src),
  },
  [ImageUpload.configure({ upload: uploadImage })],
)
const editorProps = {
  attributes: { autocorrect: 'on', autocapitalize: 'off' },
  // 이미지 파일이 먼저, 그다음 마크다운 원문 글 (pasteMarkdown)
  handlePaste: (_view: EditorView, event: ClipboardEvent) => insertImageFiles([...(event.clipboardData?.files ?? [])]) || pasteMarkdown(event),
  handleDrop: (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean) =>
    !moved && insertImageFiles([...(event.dataTransfer?.files ?? [])], view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos),
}

onMounted(() => {
  // Suspense가 실제로 붙인 문서만 완료한다. 취소되어 버려진 async branch는 mounted되지 않는다.
  if (menuSequence !== null) mobileMenu.memoReady(openingMemoId, menuSequence)
  // 메모끼리는 같은 자리에서 바꿔 끼워서([id].vue) 이전 메모의 스크롤 위치가 남는다 — 새 메모는 맨 위부터
  rootRef.value?.closest('[data-slot="body"]')?.scrollTo({ top: 0 })
  document.addEventListener('visibilitychange', onVisibility)
  attachBridge()
  void calendarSync.refresh()
  if (restoredDraft) {
    autosave?.changed()
    toast.add({ title: '이 기기에 보관해 둔 수정을 되살려 저장합니다' })
  }
})

onBeforeUnmount(() => {
  if (titleTimer) clearTimeout(titleTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})

/** 「저장 안 하고 이동」 을 골랐다 — 다시 막지 않는다 */
let discarding = false

/** 다른 화면으로 가기 전에 고친 것을 저장한다. 못 하면 가지 않는다 — 조용히 버리지 않는다 */
onBeforeRouteLeave((to) => saveBeforeLeaving(to))
/*
 * 🔴 메모 → 메모는 같은 경로(/m/:id)라 vue-router 가 «떠나기»가 아니라 «바뀜»으로 보고 위 가드를 부르지 않는다.
 *    그래서 치고 1초 안에 다른 메모를 누르면 저장 타이머가 화면과 함께 사라져 친 글을 잃었다 (2026-10-16 실측).
 *    첫 저장으로 id 가 바뀌어 주소만 고치는 것(onRenamed)은 같은 메모라 건너뛴다.
 */
onBeforeRouteUpdate((to) => (autosave && String(to.params.id) === autosave.currentId() ? true : saveBeforeLeaving(to)))

async function saveBeforeLeaving(to: RouteLocationNormalized) {
  if (!autosave || discarding || (await flushAll())) return true
  // 서버에 닿지 못했지만 이 기기에 보관했다 — 연결되면 보관함이 저장한다 (plugins/memo-drafts.client.ts)
  if (autosave.state.value.status === 'offline') {
    toast.add({ color: 'warning', title: '연결이 없어 이 기기에 보관했습니다', description: '연결되면 자동으로 저장합니다.' })
    return true
  }
  toast.add({
    color: 'error',
    title: '저장하지 못해서 이동하지 않았습니다',
    actions: [
      { label: '다시 시도', color: 'neutral', variant: 'outline', onClick: () => void autosave.save() },
      { label: '저장 안 하고 이동', color: 'error', variant: 'outline', onClick: () => void leaveWithoutSaving(to.fullPath) },
    ],
  })
  return false
}

/** UEditor 가 editor 를 만든 뒤에 네이티브 툴바를 붙인다. 몇 프레임 늦을 수 있어 기다린다 */
function attachBridge(tries = 30) {
  const editor = editorRef.value?.editor
  if (editor) bridge.attach(editor)
  else if (tries > 0) requestAnimationFrame(() => attachBridge(tries - 1))
}

async function leaveWithoutSaving(path: string) {
  discarding = true
  await navigateTo(path)
}

function onVisibility() {
  // 앱이 뒤로 가거나 탭을 바꾸면 기다리지 않고 저장한다
  if (document.visibilityState === 'hidden' && !discarding) void flushAll()
}

function onSaved(saved: Memo, previous: Memo) {
  currentFolder.value = saved.folder
  // 사이드바가 쓰는 것(제목·경로·날짜·태그)이 바뀌었을 때만 트리를 다시 받는다
  if (
    saved.title !== previous.title ||
    saved.path !== previous.path ||
    saved.date !== previous.date ||
    saved.tags.join('\n') !== previous.tags.join('\n')
  ) {
    void refreshTree()
  }
  // 캘린더에 보이는 것(제목·날짜)이 바뀌었으면 서버의 대조가 끝난 뒤 반영 실패 여부를 다시 본다
  if (saved.title !== previous.title || saved.date !== previous.date || saved.dateEnd !== previous.dateEnd) calendarSync.recheckSoon()
  if (saved.id !== previous.id) emit('renamed', previous.id, saved.id)
}

let baseline: string | null = null

/**
 * 에디터는 처음 뜰 때도 변경을 한 번 알린다(문서 끝에 빈 줄을 붙이는 등). 그건 사람의 수정이 아니다 —
 * 원본을 에디터로 한 번 정리한 결과와 같으면 저장하지 않는다. 열기만 해도 파일이 바뀌면 안 된다.
 */
function onContentChange(value: string) {
  const editor = editorRef.value?.editor
  const initial = baseline === null
  if (baseline === null && editor?.markdown) {
    baseline = canonicalMarkdown(editor.markdown.serialize(editor.markdown.parse(memo.value?.content ?? '')))
  }
  const changed = shouldSaveMarkdown(value, content.value, initial ? baseline : null)
  content.value = value
  if (changed) autosave?.changed()
}

const TITLE_DELAY_MS = 5000
let titleTimer: ReturnType<typeof setTimeout> | null = null

function onTitleInput() {
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = setTimeout(commitTitle, TITLE_DELAY_MS)
}

/** 입력칸의 제목을 저장에 싣는다. 저장(과 파일 이름 변경)은 자동저장이 이어서 한다 */
function commitTitle() {
  if (titleTimer) clearTimeout(titleTimer)
  titleTimer = null
  if (title.value === savedTitle.value) return
  savedTitle.value = title.value
  autosave?.changed()
}

/** 나가기·숨김·옮기기 전 — 확정 안 된 제목까지 실어서 지금 저장한다 */
function flushAll() {
  commitTitle()
  return autosave ? autosave.flush() : Promise.resolve(true)
}

/** 제목에서 Enter → 본문 첫 줄로. 한글 조합 중의 Enter 는 글자 확정이라 건드리지 않는다 */
function onTitleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing) return
  event.preventDefault()
  editorRef.value?.editor?.commands.focus('start')
}

/**
 * 입력칸은 중복을 받아들이게 두고(duplicate) 여기서 뺀다. 거절하게 두면 이미 있는 태그를 치고 Enter 를 눌렀을 때
 * 아무 표시 없이 글자가 남고, 이어 친 글자와 붙어 `웹킷사파리` 같은 태그가 생긴다 (2026-10-07 실측).
 * 결과가 같아도 새 배열을 넣는다 — 그래야 입력칸이 방금 받은 중복·`#한글` 칩을 지우고 정리한 값으로 다시 그린다.
 */
function onTagsChange(value: string[]) {
  const next = cleanTags(value)
  const changed = !sameTags(next, tags.value)
  tags.value = next
  if (changed) autosave?.changed()
}

function onDateChange(start: string | null, end: string | null) {
  date.value = start
  dateEnd.value = end
  autosave?.changed()
}

/** 보관해 둔 수정을 입력칸에 채운다. 에디터는 content 가 바뀌면 다시 그린다 */
function applyDraft(draft: MemoDraft) {
  title.value = draft.input.title
  savedTitle.value = draft.input.title
  content.value = draft.input.content
  date.value = draft.input.date
  dateEnd.value = draft.input.dateEnd
  tags.value = draft.input.tags
}

/** 서버가 바뀐 뒤의 보관 수정 — 그래도 내 것으로 덮어쓴다 */
function keepStaleDraft() {
  const draft = staleDraft.value
  if (!draft || !autosave) return
  applyDraft(draft)
  staleDraft.value = null
  // 지금 서버 버전을 기준으로 보낸다 — 덮어쓰기를 사람이 골랐다
  void autosave.save()
}

function discardStaleDraft() {
  if (staleDraft.value) removeDraft(staleDraft.value.id)
  staleDraft.value = null
}

/** `2026-10-07T02:00:00.000Z` → `10월 7일 오전 11:00` */
function draftTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

async function reloadFromServer() {
  if (!autosave) return
  const fresh = await autosave.reload()
  title.value = fresh.title
  savedTitle.value = fresh.title
  content.value = fresh.content
  date.value = fresh.date
  dateEnd.value = fresh.dateEnd
  tags.value = fresh.tags
}

/** 브라우저에서 줄여서 이 메모 폴더의 assets/ 로 올린다(줄였으면 원본도). 본문에 넣을 상대경로를 돌려준다 */
async function uploadImage(file: Blob, name = 'image') {
  return uploadPrepared(await prepareImage(file), name)
}

async function uploadPrepared(image: PreparedImage, name = 'image') {
  const body = new FormData()
  body.append('file', image.display, name)
  if (image.original) body.append('original', image.original, name)
  const id = autosave?.currentId() ?? props.memoId
  const { src } = await $fetch<{ src: string }>(`/api/memos/${encodeURIComponent(id)}/images`, { method: 'POST', body })
  if (image.originalSkipped) {
    toast.add({
      color: 'warning',
      title: '줄인 이미지만 저장했습니다',
      description: image.originalSkipped === 'size' ? '원본이 30MB 를 넘어 보관하지 못했습니다.' : '이 형식(HEIC 등)은 원본을 보관하지 못합니다.',
    })
  }
  return src
}

/** 붙여넣기·끌어 놓기로 들어온 이미지 파일. 이미지가 없으면 false — 원래 동작에 맡긴다 */
function insertImageFiles(files: File[], at?: number) {
  const images = files.filter((f) => f.type.startsWith('image/'))
  const editor = editorRef.value?.editor
  if (!images.length || !editor) return false
  void (async () => {
    for (const file of images) {
      try {
        const src = await uploadImage(file, file.name)
        const chain = editor.chain().focus()
        ;(at === undefined ? chain.setImage({ src }) : chain.insertContentAt(at, { type: 'image', attrs: { src } })).run()
      } catch (e) {
        toast.add({ color: 'error', title: apiMessage(e, `「${file.name}」 을 올리지 못했습니다`) })
      }
    }
  })()
  return true
}

/**
 * 다른 폴더의 이미지를 붙여넣으면 상대경로로 되돌릴 수 없어 화면 주소(/api/files/…)가 남는다.
 * 그 이미지를 받아 이 메모 폴더에 다시 올리고 src 를 바꾼다 (설계문서 §4 — 이미지는 항상 같은 폴더의 assets/).
 */
async function rehomeForeignImages(editor: Editor) {
  const foreign = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('/api/files/')) foreign.add(node.attrs.src)
  })
  for (const src of foreign) {
    try {
      // 원본을 따로 보관한 이미지면 원본도 같이 옮긴다 — 안 그러면 원래 메모가 이미지를 지울 때 원본이 사라진다
      const display = await $fetch<Blob>(src, { responseType: 'blob' })
      const originalSrc = originalOfDisplay(src)
      const originalRes = originalSrc ? await $fetch.raw<Blob>(originalSrc, { responseType: 'blob' }) : null
      const original = originalRes?.headers.get('x-memo-original') === 'stored' ? (originalRes._data ?? null) : null
      const next = await uploadPrepared({ display, original, originalSkipped: null })
      // 올리는 동안 문서가 바뀌었을 수 있다 — 위치가 아니라 src 로 다시 찾는다
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === src) {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next }))
        }
      })
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '다른 폴더의 이미지를 가져오지 못했습니다') })
    }
  }
}

/**
 * 🔴 열 주소는 이 앱의 원본 주소나 http(s) 만 — `![](javascript:…)` 같은 이미지가 내려받기 링크(href)로 새면 스크립트가 돈다
 *    (2026-10-07 보안 검토 지적).
 */
function showOriginal(src: string) {
  const url = toOriginalSrc(folder, src)
  if (!url.startsWith('/api/originals/') && !/^https?:\/\//i.test(url)) {
    toast.add({ color: 'warning', title: '이 이미지는 원본을 열 수 없습니다' })
    return
  }
  originalFit.value = true
  originalUrl.value = url
}

/**
 * 마크다운 원문을 붙여 넣으면 서식으로 넣는다 (2026-10-15 사용자 요청). 언제 기본 붙여넣기에 맡기는지는 utils/markdown-paste.ts.
 * 코드 블록 안에서는 코드를 글자 그대로 둔다.
 */
function pasteMarkdown(event: ClipboardEvent) {
  const editor = editorRef.value?.editor
  const data = event.clipboardData
  if (!editor || !data || editor.isActive('codeBlock')) return false
  const text = data.getData('text/plain')
  if (!text || isRichHtml(data.getData('text/html')) || !looksLikeMarkdown(text)) return false
  return editor.chain().focus().insertContent(text, { contentType: 'markdown' }).run()
}

function onPaste() {
  const editor = editorRef.value?.editor
  if (editor) setTimeout(() => rehomeForeignImages(editor))
}

function onNodeChange(event: { node: JSONContent | null; pos: number }) {
  selectedNode.value = event
}

function showTextBubble({ editor, view, state }: MenuContext) {
  if (coarsePointer || blockMoveActive.value) return false
  if (editor.isActive('imageUpload') || editor.isActive('image') || state.selection instanceof CellSelection) return false
  return view.hasFocus() && !state.selection.empty
}

function showImageBubble({ editor, view }: MenuContext) {
  return !blockMoveActive.value && editor.isActive('image') && view.hasFocus()
}

/**
 * 템플릿은 칸을 여러 개 끌어 골랐을 때(CellSelection)만 띄운다. 표 안에 커서만 있어도 띄운다 —
 * 행·열을 더하려고 칸을 끌어 고르는 사람은 없다. 글자를 고르면 글자 말풍선이 대신 뜬다.
 */
function showTableBubble({ editor, view, state }: MenuContext) {
  if (blockMoveActive.value || !view.hasFocus()) return false
  return state.selection instanceof CellSelection || (editor.isActive('table') && state.selection.empty)
}
</script>

<template>
  <div ref="rootRef" class="w-full min-w-0">
    <div v-if="error || !memo || !autosave" class="flex h-full flex-col items-center justify-center gap-3 text-center">
      <UIcon name="i-material-symbols-error-outline" class="size-10 text-error" />
      <p class="text-muted">{{ apiMessage(error, '메모를 열지 못했습니다') }}</p>
      <UButton to="/" color="neutral" variant="outline">처음으로</UButton>
    </div>

    <UEditor
      v-else
      ref="editorRef"
      v-slot="{ editor, handlers }"
      :model-value="content"
      content-type="markdown"
      :starter-kit="{ underline: false, codeBlock: false }"
      :image="false"
      :mention="false"
      :extensions="extensions"
      :handlers="customHandlers"
      :editable="!memo.unreadable"
      :editor-props="editorProps"
      placeholder="내용을 입력하세요. 「/」 로 블록 넣기"
      :ui="{ base: 'sm:px-0 pt-6 pb-32 min-h-[50dvh]', content: 'mx-auto w-full max-w-4xl px-4 sm:px-14' }"
      @update:model-value="onContentChange"
      @paste="onPaste"
    >
      <Teleport to="#app-header-toolbar" defer>
        <UEditorToolbar v-if="!blockMoveActive" :editor="editor" :items="toolbarItems" />
      </Teleport>
      <Teleport to="#app-header-actions" defer>
        <MemoSaveStatus :state="saveState" @retry="autosave.save()" />
        <MemoActions v-if="!blockMoveActive" :memo-id="autosave.currentId" :title="() => savedTitle" :folder="currentFolder" />
      </Teleport>

      <MobileBlockMove
        v-model:active="blockMoveActive"
        :editor="editor"
        :disabled="memo.unreadable"
        @add-block="pos => handlers.suggestion?.execute(editor, { pos }).run()"
      />

      <!-- 좁은 화면의 브라우저(껍데기 밖)에서는 위 줄 가운데가 숨는다 — 툴바를 한 줄 아래로 내린다 -->
      <Teleport v-if="!bridge.native && !blockMoveActive" to="#app-header-secondary" defer>
        <div class="overflow-x-auto border-b border-default px-2 py-1 lg:hidden">
          <UEditorToolbar :editor="editor" :items="toolbarItems" />
        </div>
      </Teleport>

      <div class="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-14 sm:pt-10">
        <UAlert
          v-if="memo.unreadable"
          color="warning"
          variant="subtle"
          icon="i-material-symbols-warning-outline"
          title="frontmatter 를 읽을 수 없어 읽기 전용으로 엽니다"
          description="파일을 직접 고친 뒤 다시 여세요."
          class="mb-6"
        />
        <UAlert
          v-if="autosave.state.value.status === 'conflict'"
          color="warning"
          variant="subtle"
          icon="i-material-symbols-warning-outline"
          title="다른 곳에서 먼저 수정했습니다"
          description="다른 기기나 파일 편집기에서 이 메모를 바꿨습니다. 어느 쪽을 남길지 고르세요."
          class="mb-6"
          data-testid="memo-conflict-alert"
          :actions="[
            { label: '다시 불러오기', color: 'neutral', variant: 'outline', onClick: reloadFromServer },
            { label: '내 내용으로 덮어쓰기', color: 'warning', onClick: () => autosave?.overwrite() },
          ]"
        />
        <UAlert
          v-if="staleDraft"
          color="warning"
          variant="subtle"
          icon="i-material-symbols-cloud-off-outline"
          :title="`이 기기에 저장하지 못한 수정이 있습니다 (${draftTime(staleDraft.savedAt)})`"
          description="그 뒤에 다른 곳에서 이 메모가 바뀌었습니다. 어느 쪽을 남길지 고르세요."
          class="mb-6"
          data-testid="memo-draft-alert"
          :actions="[
            { label: '보관된 수정 버리기', color: 'neutral', variant: 'outline', onClick: discardStaleDraft },
            { label: '보관된 수정으로 덮어쓰기', color: 'warning', onClick: keepStaleDraft },
          ]"
        />
        <UAlert
          v-if="autosave.state.value.status === 'format'"
          color="warning"
          variant="subtle"
          icon="i-material-symbols-warning-outline"
          title="앱에서 저장하면 이 파일의 형식이 바뀝니다"
          description="다른 도구로 쓴 문법 중 이 앱이 모르는 것(각주, HTML 블록 등)은 저장할 때 사라지거나 글자로 바뀔 수 있습니다."
          class="mb-6"
          data-testid="memo-format-alert"
          :actions="[{ label: '알겠습니다, 저장', color: 'warning', onClick: () => autosave?.acceptFormat() }]"
        />
        <div class="flex items-center gap-3">
          <UCheckbox
            v-if="todoDone !== null && autosave"
            :model-value="todoDone"
            :disabled="todo.pending.value.includes(autosave.currentId())"
            :aria-label="todoDone ? '안 끝난 것으로 되돌리기' : '끝냄'"
            size="xl"
            data-testid="memo-todo-check"
            @update:model-value="todo.setDone(autosave.currentId(), !todoDone)"
          />
          <input
            v-model="title"
            placeholder="제목"
            class="min-w-0 flex-1 bg-transparent text-3xl font-bold outline-none placeholder:text-dimmed"
            :class="todoDone && 'text-muted line-through'"
            :readonly="memo.unreadable || blockMoveActive"
            enterkeyhint="next"
            data-testid="memo-title-input"
            @input="onTitleInput"
            @blur="commitTitle"
            @keydown="onTitleKeydown"
          >
        </div>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          <MemoDatePicker :date="date" :date-end="dateEnd" :disabled="memo.unreadable" @change="onDateChange" />
          <MemoCalendarSyncBadge :memo-id="autosave.currentId()" :has-date="!!date" />
          <span class="text-xs text-dimmed">{{ currentFolder || '최상위' }}</span>
        </div>
        <!-- 태그 — 공백·쉼표·Enter 로 끊는다. 한글 조합 중의 입력은 TagsInput 이 기다려 준다 -->
        <UInputTags
          :model-value="tags"
          icon="i-material-symbols-sell-outline"
          placeholder="태그 추가"
          variant="ghost"
          size="sm"
          :delimiter="TAG_DELIMITER"
          :max="MAX_TAGS"
          :max-length="MAX_TAG_LENGTH"
          add-on-blur
          add-on-paste
          duplicate
          :disabled="memo.unreadable"
          class="mt-2 -ms-2.5 w-full"
          data-testid="memo-tags-input"
          @update:model-value="onTagsChange"
        >
          <template #item-text="{ item }">
            <span class="text-dimmed">#</span>{{ item }}
          </template>
        </UInputTags>
      </div>

      <UEditorToolbar :editor="editor" :items="bubbleToolbarItems" layout="bubble" :should-show="showTextBubble">
        <template #link>
          <LinkPopover :editor="editor" />
        </template>
      </UEditorToolbar>

      <UEditorToolbar :editor="editor" :items="imageToolbarItems(editor, { showOriginal })" layout="bubble" :should-show="showImageBubble" />

      <UEditorToolbar :editor="editor" :items="tableToolbarItems(editor)" layout="bubble" :should-show="showTableBubble" />

      <UEditorEmojiMenu :editor="editor" :items="emojiItems" />

      <UEditorSuggestionMenu :editor="editor" :items="suggestionItems" :filter-fields="['label', 'keywords']" />

      <UEditorDragHandle v-if="!blockMoveActive" v-slot="{ ui, onClick }" :editor="editor" :options="blockHandleOptions" :ui="blockHandleUi" @node-change="onNodeChange">
        <UButton
          icon="i-material-symbols-add"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="블록 넣기"
          :class="ui.handle()"
          @click="(e: MouseEvent) => {
            e.stopPropagation()
            const node = onClick()
            handlers.suggestion?.execute(editor, { pos: node?.pos }).run()
          }"
        />
        <UDropdownMenu
          v-slot="{ open }"
          :modal="false"
          :items="dragHandleItems(editor, selectedNode)"
          :content="{ side: 'left' }"
          :ui="{ content: 'w-48', label: 'text-xs' }"
          @update:open="editor.chain().setMeta('lockDragHandle', $event).run()"
        >
          <UButton
            color="neutral"
            variant="ghost"
            active-variant="soft"
            size="sm"
            icon="i-material-symbols-drag-indicator"
            aria-label="블록 메뉴 · 끌어서 옮기기"
            :active="open"
            :class="ui.handle()"
          />
        </UDropdownMenu>
      </UEditorDragHandle>

      <LinkDialog v-model:open="linkOpen" :editor="editor" />

      <!-- 원본 보기 — 확대가 막혀 있으니 「원래 크기」로 놓고 밀어서 본다 -->
      <UModal
        :open="originalUrl !== null"
        title="원본"
        fullscreen
        :ui="{ body: 'p-0 sm:p-0 overflow-auto' }"
        @update:open="(v: boolean) => !v && (originalUrl = null)"
      >
        <template #body>
          <div class="flex min-h-full items-center justify-center" :class="!originalFit && 'items-start justify-start'">
            <img
              v-if="originalUrl"
              :src="originalUrl"
              alt="원본 이미지"
              :class="originalFit ? 'max-h-[calc(100dvh-8rem)] max-w-full object-contain' : 'max-w-none'"
              data-testid="memo-original-image"
            >
          </div>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="outline"
              :icon="originalFit ? 'i-material-symbols-fit-screen-outline' : 'i-material-symbols-fullscreen'"
              data-testid="memo-original-fit"
              @click="originalFit = !originalFit"
            >
              {{ originalFit ? '원래 크기' : '화면에 맞춤' }}
            </UButton>
            <UButton
              v-if="!coarsePointer && originalUrl"
              color="neutral"
              variant="outline"
              icon="i-material-symbols-download"
              :to="originalUrl"
              target="_blank"
              external
              download
            >
              내려받기
            </UButton>
            <UButton data-testid="memo-original-close" @click="originalUrl = null">닫기</UButton>
          </div>
        </template>
      </UModal>
    </UEditor>
  </div>
</template>
