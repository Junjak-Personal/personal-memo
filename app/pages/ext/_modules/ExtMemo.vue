<script setup lang="ts">
/**
 * 외부 공개 메모 본문 — 읽기 전용. 공개 탐색 메뉴는 이 본문 바깥의 ExtLayout이 그린다.
 * 본문은 편집기와 같은 확장(memoExtensions)으로 그린다. 이미지는 본문 속 경로를 그대로 공개 이미지 주소로 보낸다 —
 * 서버가 그 메모가 참조하는 이미지만 내준다(store.publicImage).
 */
import type { PublicMemo } from '#shared/types/memo'
import { isRelativeSrc } from '#shared/utils/asset-path'
import { memoExtensions } from '~/utils/editor-extensions'
import { disablePublicMemoLinks, preventPublicMemoLink } from '~/utils/public-memo-links'

const props = defineProps<{ memoId: string }>()
const publicRoot = useTemplateRef<HTMLElement>('publicRoot')
let linkObserver: MutationObserver | null = null

const { data: memo, error, status, refresh } = useAsyncData(
  `ext-${props.memoId}`,
  () => $fetch<PublicMemo>(`/api/ext/${encodeURIComponent(props.memoId)}`),
  { getCachedData: () => undefined },
)

const imageBase = `/api/ext/${encodeURIComponent(props.memoId)}/image?src=`
const extensions = memoExtensions({
  toDisplay: (src: string) => (isRelativeSrc(src) ? imageBase + encodeURIComponent(src) : src),
  toStored: (src: string) => src,
})

const updatedLabel = computed(() =>
  memo.value?.updated ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(new Date(memo.value.updated)) : null,
)

onMounted(() => {
  const root = publicRoot.value
  if (!root) return
  disablePublicMemoLinks(root)
  linkObserver = new MutationObserver(() => disablePublicMemoLinks(root))
  linkObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
})
onBeforeUnmount(() => linkObserver?.disconnect())

useHead({
  title: () => memo.value?.title || '메모',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ],
})
</script>

<template>
  <main ref="publicRoot" class="min-h-dvh bg-default" @click.capture="preventPublicMemoLink" @keydown.capture="preventPublicMemoLink">
    <div v-if="status === 'pending'" class="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-14" role="status" aria-label="공개 메모를 불러오는 중" data-testid="ext-loading">
      <USkeleton class="h-9 w-2/3" />
      <USkeleton v-for="index in 4" :key="index" class="h-5 w-full" />
    </div>
    <div v-else-if="error || !memo" class="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center" data-testid="ext-missing">
      <UIcon name="i-material-symbols-lock-outline" class="size-10 text-dimmed" />
      <p class="text-muted">
        {{ apiStatus(error) === 404 ? '공개되지 않았거나 없는 메모입니다' : apiMessage(error, '메모를 열지 못했습니다') }}
      </p>
      <UButton v-if="apiStatus(error) !== 404" color="neutral" variant="outline" data-testid="ext-retry" @click="refresh()">다시 시도</UButton>
    </div>

    <article v-else class="pb-24" data-testid="ext-memo">
      <header class="mx-auto w-full max-w-4xl px-4 pt-10 sm:px-14">
        <h1 class="text-3xl font-bold break-words" data-testid="ext-title">{{ memo.title }}</h1>
        <p v-if="updatedLabel" class="mt-2 text-xs text-dimmed">{{ updatedLabel }} 수정</p>
      </header>
      <UEditor
        :model-value="memo.content"
        content-type="markdown"
        :starter-kit="{ underline: false, codeBlock: false }"
        :image="false"
        :mention="false"
        :extensions="extensions"
        :editable="false"
        :ui="{ base: 'sm:px-0 pt-6', content: 'mx-auto w-full max-w-4xl px-4 sm:px-14' }"
        data-testid="ext-body"
      />
    </article>
  </main>
</template>
