<script setup lang="ts">
import type { EditorEvents } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'
import type { SelectionBookmark } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/vue-3'
import { imageHeightForWidth, memoImageDimension } from '~/utils/editor-image'

const props = defineProps<{ editor: Editor; disabled?: boolean }>()
const id = useId()
const open = ref(false)
const target = shallowRef<{ kind: 'image' | 'code'; pos: number; node: ProseMirrorNode } | null>(null)
const captured = shallowRef<typeof target.value>(null)
const altInput = ref('')
const titleInput = ref('')
const widthInput = ref('')
const sizeReset = ref(false)
const languageInput = ref('')
const error = ref('')
const copyState = ref<'idle' | 'copying' | 'copied'>('idle')
const composing = ref(false)
let aspectWidth: number | null = null
let aspectHeight: number | null = null
let selectionBookmark: SelectionBookmark | null = null

const languages = [
  { value: '', label: '일반 텍스트' },
  { value: 'javascript', label: 'JavaScript' }, { value: 'typescript', label: 'TypeScript' },
  { value: 'jsx', label: 'JSX' }, { value: 'tsx', label: 'TSX' },
  { value: 'python', label: 'Python' }, { value: 'go', label: 'Go' }, { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' }, { value: 'kotlin', label: 'Kotlin' }, { value: 'swift', label: 'Swift' },
  { value: 'c', label: 'C' }, { value: 'cpp', label: 'C++' }, { value: 'csharp', label: 'C#' },
  { value: 'html', label: 'HTML' }, { value: 'css', label: 'CSS' }, { value: 'scss', label: 'SCSS' },
  { value: 'json', label: 'JSON' }, { value: 'yaml', label: 'YAML' }, { value: 'toml', label: 'TOML' },
  { value: 'bash', label: 'Shell' }, { value: 'sql', label: 'SQL' }, { value: 'markdown', label: 'Markdown' },
  { value: 'dockerfile', label: 'Dockerfile' },
]
const title = computed(() => (open.value ? captured.value : target.value)?.kind === 'image' ? '이미지 설정' : '코드 설정')
const originalLanguage = computed(() => {
  const language = captured.value?.node.attrs.language
  return typeof language === 'string' ? language : ''
})
const customLanguage = computed(() => originalLanguage.value && !languages.some(item => item.value === originalLanguage.value) ? originalLanguage.value : '')

function sync(event?: EditorEvents['transaction']) {
  if (props.editor.isDestroyed) return
  const { selection } = props.editor.state
  if (selection instanceof NodeSelection && ['image', 'codeBlock'].includes(selection.node.type.name)) {
    target.value = { kind: selection.node.type.name === 'image' ? 'image' : 'code', pos: selection.from, node: selection.node }
  } else {
    target.value = null
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const node = selection.$from.node(depth)
      if (node.type.name !== 'codeBlock') continue
      target.value = { kind: 'code', pos: selection.$from.before(depth), node }
      break
    }
  }
  if (!open.value || !captured.value || !event?.transaction.docChanged) return
  const mapped = event.transaction.mapping.mapResult(captured.value.pos)
  const current = props.editor.state.doc.nodeAt(mapped.pos)
  if (mapped.deleted || !current?.eq(captured.value.node)) {
    error.value = '선택한 블록이 바뀌었습니다. 닫은 뒤 다시 선택해 주세요.'
    captured.value = null
    selectionBookmark = null
  } else {
    captured.value = { ...captured.value, pos: mapped.pos }
    selectionBookmark = selectionBookmark?.map(event.transaction.mapping) ?? null
  }
}

function show() {
  sync()
  if (!target.value || props.disabled || !props.editor.isEditable) return
  captured.value = target.value
  selectionBookmark = props.editor.state.selection.getBookmark()
  const { node, pos, kind } = captured.value
  altInput.value = typeof node.attrs.alt === 'string' ? node.attrs.alt : ''
  titleInput.value = typeof node.attrs.title === 'string' ? node.attrs.title : ''
  const width = memoImageDimension(node.attrs.width)
  const height = memoImageDimension(node.attrs.height)
  widthInput.value = width ? String(width) : ''
  sizeReset.value = false
  languageInput.value = typeof node.attrs.language === 'string' ? node.attrs.language : ''
  const dom = kind === 'image' ? props.editor.view.nodeDOM(pos) : null
  const image = dom instanceof HTMLImageElement ? dom : dom instanceof HTMLElement ? dom.querySelector('img') : null
  aspectWidth = width && height ? width : image?.naturalWidth || null
  aspectHeight = width && height ? height : image?.naturalHeight || null
  error.value = ''
  copyState.value = 'idle'
  open.value = true
}

function onOpen(value: boolean) {
  if (value) show()
  else open.value = false
}

function apply() {
  if (composing.value || props.disabled || !props.editor.isEditable || props.editor.isDestroyed) return
  const selected = captured.value
  if (!selected || !props.editor.state.doc.nodeAt(selected.pos)?.eq(selected.node)) {
    error.value = '선택한 블록이 바뀌었습니다. 닫은 뒤 다시 선택해 주세요.'
    return
  }
  error.value = ''
  if (selected.kind === 'image') {
    const width = !sizeReset.value && widthInput.value.trim() ? memoImageDimension(widthInput.value) : null
    if (widthInput.value.trim() && !width) { error.value = '가로 크기는 1부터 10000 사이의 정수로 입력하세요.'; return }
    const originalWidth = memoImageDimension(selected.node.attrs.width)
    const height = sizeReset.value ? null : width === originalWidth
      ? memoImageDimension(selected.node.attrs.height)
      : width ? imageHeightForWidth(width, aspectWidth, aspectHeight) : null
    if (width !== originalWidth && width && !height) { error.value = '이미지를 불러온 뒤 크기를 변경해 주세요.'; return }
    const changed = props.editor.chain().focus().setNodeSelection(selected.pos)
      .updateAttributes('image', { alt: altInput.value || null, title: titleInput.value || null, width, height }).run()
    if (changed) open.value = false
    else error.value = '이미지 설정을 적용하지 못했습니다.'
  } else {
    const language = languageInput.value
    if (language && !/^[a-zA-Z][\w.+-]{0,39}$/.test(language)) { error.value = '지원하는 코드 언어를 선택해 주세요.'; return }
    const changed = props.editor.chain().focus().command(({ tr }) => {
      const node = tr.doc.nodeAt(selected.pos)
      if (!node?.eq(selected.node)) return false
      tr.setNodeMarkup(selected.pos, undefined, { ...node.attrs, language: language || null })
      if (selectionBookmark) tr.setSelection(selectionBookmark.resolve(tr.doc))
      return true
    }).run()
    if (changed) open.value = false
    else error.value = '코드 설정을 적용하지 못했습니다.'
  }
}

async function copyCode() {
  const selected = captured.value
  if (!selected || selected.kind !== 'code' || copyState.value === 'copying') return
  copyState.value = 'copying'
  try {
    await navigator.clipboard.writeText(selected.node.textContent)
    copyState.value = 'copied'
    error.value = ''
  } catch {
    copyState.value = 'idle'
    error.value = '코드를 복사하지 못했습니다. 본문에서 코드를 선택해 복사해 주세요.'
  }
}

watch(() => props.disabled, disabled => { if (disabled) open.value = false })
onMounted(() => { sync(); props.editor.on('transaction', sync) })
onBeforeUnmount(() => props.editor.off('transaction', sync))
defineExpose({ show })
</script>

<template>
  <UPopover v-if="target || open" :open="open" :content="{ align: 'end' }" @update:open="onOpen">
    <UTooltip :text="title">
      <UButton
        icon="i-material-symbols-tune"
        color="neutral"
        variant="ghost"
        class="size-11 shrink-0 justify-center lg:size-8"
        :aria-label="title"
        :disabled="disabled || !editor.isEditable"
        data-testid="memo-block-properties-open"
      />
    </UTooltip>
    <template #content>
      <form class="w-80 max-w-[calc(100vw-2rem)] space-y-4 p-4" :aria-labelledby="`${id}-title`" @submit.prevent="apply" @compositionstart="composing = true" @compositionend="composing = false">
        <h2 :id="`${id}-title`" class="font-medium">{{ title }}</h2>
        <template v-if="captured?.kind === 'image'">
          <div class="space-y-1">
            <label :for="`${id}-alt`" class="block text-sm font-medium">대체 텍스트</label>
            <UInput :id="`${id}-alt`" v-model="altInput" name="image-alt" class="w-full" data-testid="memo-image-alt-input" @input="error = ''" />
          </div>
          <div class="space-y-1">
            <label :for="`${id}-caption`" class="block text-sm font-medium">이미지 제목</label>
            <UInput :id="`${id}-caption`" v-model="titleInput" name="image-title" class="w-full" data-testid="memo-image-title-input" @input="error = ''" />
            <p class="text-xs text-muted">이미지에 마우스를 올리면 표시되는 설명입니다.</p>
          </div>
          <div class="space-y-1">
            <label :for="`${id}-width`" class="block text-sm font-medium">가로 크기 (px)</label>
            <UInput :id="`${id}-width`" v-model="widthInput" name="image-width" inputmode="numeric" autocomplete="off" :aria-describedby="`${id}-width-help ${id}-error`" :aria-invalid="!!error" class="w-full" data-testid="memo-image-width-input" @input="error = ''; sizeReset = false" />
            <p :id="`${id}-width-help`" class="text-xs text-muted">1~10000px. 비우면 원래 크기로 표시합니다. 세로 비율은 유지됩니다.</p>
            <UButton type="button" color="neutral" variant="outline" size="xs" data-testid="memo-image-size-reset" @click="widthInput = ''; sizeReset = true; error = ''">원래 크기</UButton>
          </div>
        </template>
        <template v-else-if="captured?.kind === 'code'">
          <div class="space-y-1">
            <label :for="`${id}-language`" class="block text-sm font-medium">코드 언어</label>
            <select :id="`${id}-language`" v-model="languageInput" name="code-language" class="min-h-11 w-full rounded-md border border-default bg-default px-3 text-base text-default focus-visible:outline-2 focus-visible:outline-primary" data-testid="memo-code-language-select" @change="error = ''">
              <option v-if="customLanguage" :value="customLanguage">{{ customLanguage }}</option>
              <option v-for="language in languages" :key="language.value" :value="language.value">{{ language.label }}</option>
            </select>
          </div>
          <UButton type="button" color="neutral" variant="outline" icon="i-material-symbols-content-copy-outline" :loading="copyState === 'copying'" data-testid="memo-code-copy" @click="copyCode">{{ copyState === 'copied' ? '복사됨' : '코드 복사' }}</UButton>
          <p v-if="copyState === 'copied'" role="status" class="text-xs text-muted">코드를 클립보드에 복사했습니다.</p>
        </template>
        <p v-if="error" :id="`${id}-error`" role="alert" class="text-sm text-error" data-testid="memo-block-properties-error">{{ error }}</p>
        <div class="flex justify-end gap-2 border-t border-default pt-3">
          <UButton type="button" color="neutral" variant="outline" data-testid="memo-block-properties-cancel" @click="open = false">취소</UButton>
          <UButton type="submit" :disabled="!captured || disabled" data-testid="memo-block-properties-apply">적용</UButton>
        </div>
      </form>
    </template>
  </UPopover>
</template>
