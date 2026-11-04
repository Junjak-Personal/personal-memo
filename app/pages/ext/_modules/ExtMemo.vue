<script setup lang="ts">
/**
 * 외부 공개 메모 본문 — 읽기 전용. 공개 탐색 메뉴는 이 본문 바깥의 공통 공개 레이아웃이 그린다.
 * 본문은 편집기와 같은 확장(memoExtensions)으로 그린다. 이미지는 본문 속 경로를 그대로 공개 이미지 주소로 보낸다 —
 * 서버가 그 메모가 참조하는 이미지만 내준다(store.publicImage).
 */
import type { PublicMemo, PublicMemoSummary, PublicTreeResponse } from '#shared/types/memo'
import { isRelativeSrc } from '#shared/utils/asset-path'
import { memoExtensions } from '~/utils/editor-extensions'
import { disablePublicMemoLinks, preventPublicMemoLink, publicMemoHref } from '~/utils/public-memo-links'

const props = defineProps<{ memoId: string }>()
const publicRoot = useTemplateRef<HTMLElement>('publicRoot')
let linkObserver: MutationObserver | null = null
const { data: publicTree } = useNuxtData<PublicTreeResponse>('ext-navigation')
const resolvePublicHref = (id: string) => publicMemoHref(publicTree.value, id)

const { data: memo, error, status, refresh } = useAsyncData(
  `ext-${props.memoId}`,
  () => $fetch<PublicMemo>(`/api/ext/${encodeURIComponent(props.memoId)}`),
  { getCachedData: () => undefined },
)
const { data: backlinks, error: backlinksError, status: backlinksStatus, refresh: refreshBacklinks } = useAsyncData(
  `ext-backlinks:${props.memoId}`,
  () => $fetch<PublicMemoSummary[]>(`/api/ext/${encodeURIComponent(props.memoId)}/backlinks`),
  { getCachedData: () => undefined },
)

const imageBase = `/api/ext/${encodeURIComponent(props.memoId)}/image?src=`
const extensions = memoExtensions({
  toDisplay: (src: string) => (isRelativeSrc(src) ? imageBase + encodeURIComponent(src) : src),
  toStored: (src: string) => src,
}, [], { publicHref: resolvePublicHref })

const updatedLabel = computed(() =>
  memo.value?.updated ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' }).format(new Date(memo.value.updated)) : null,
)

function syncPublicLinks() {
  if (publicRoot.value) disablePublicMemoLinks(publicRoot.value, resolvePublicHref)
}

onMounted(() => {
  const root = publicRoot.value
  if (!root) return
  syncPublicLinks()
  linkObserver = new MutationObserver(syncPublicLinks)
  linkObserver.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] })
})
onBeforeUnmount(() => linkObserver?.disconnect())
// 공개 목록의 지연 조회·새로고침은 본문 편집과 별개이므로 DOM의 링크만 갱신한다.
watch(publicTree, syncPublicLinks, { flush: 'post' })

useHead({
  title: () => memo.value?.title || '메모',
  meta: [
    { name: 'robots', content: 'noindex, nofollow' },
    { name: 'referrer', content: 'no-referrer' },
  ],
})
</script>

<template>
  <main ref="publicRoot" class="min-h-full bg-default" @click.capture="preventPublicMemoLink($event, resolvePublicHref)" @keydown.capture="preventPublicMemoLink($event, resolvePublicHref)">
    <div v-if="status === 'pending'" class="mx-auto w-full max-w-4xl space-y-6 px-4 py-10 sm:px-14" role="status" aria-label="공개 메모를 불러오는 중" data-testid="ext-loading">
      <USkeleton class="h-9 w-2/3" />
      <USkeleton v-for="index in 4" :key="index" class="h-5 w-full" />
    </div>
    <div v-else-if="error || !memo" class="flex min-h-80 flex-col items-center justify-center gap-3 px-4 text-center" data-testid="ext-missing">
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
        :starter-kit="{ underline: false, codeBlock: false, link: { openOnClick: true } }"
        :image="false"
        :mention="false"
        :extensions="extensions"
        :editable="false"
        :ui="{ base: 'sm:px-0 pt-6', content: 'mx-auto w-full max-w-4xl px-4 sm:px-14' }"
        data-testid="ext-body"
      />
      <section class="mx-auto mt-8 w-full max-w-4xl px-4 sm:px-14" aria-label="연결 메모" data-testid="ext-backlinks">
        <div class="mb-3 flex items-center justify-between gap-2 border-t border-default pt-4">
          <h2 class="text-sm font-medium text-muted">연결 메모 <span v-if="backlinks?.length">{{ backlinks.length }}</span></h2>
          <UButton icon="i-material-symbols-refresh" color="neutral" variant="ghost" size="sm" :loading="backlinksStatus === 'pending'" aria-label="연결 메모 새로고침" data-testid="ext-backlinks-refresh" @click="refreshBacklinks()" />
        </div>
        <div v-if="backlinksStatus === 'pending'" class="space-y-2" role="status" aria-label="연결 메모를 불러오는 중" data-testid="ext-backlinks-loading">
          <USkeleton v-for="index in 2" :key="index" class="h-11 w-full" />
        </div>
        <div v-else-if="backlinksError" class="space-y-3" data-testid="ext-backlinks-error">
          <UAlert title="연결 메모를 불러오지 못했습니다" color="error" variant="subtle" />
          <UButton color="neutral" variant="outline" data-testid="ext-backlinks-retry" @click="refreshBacklinks()">다시 시도</UButton>
        </div>
        <div v-else-if="backlinks?.length" class="flex flex-col gap-1">
          <NuxtLink v-for="(row, index) in backlinks" :key="row.id" :to="`/ext/${encodeURIComponent(row.id)}`" class="rounded-md border border-default px-3 py-2 text-sm hover:bg-elevated" :data-testid="`ext-backlink-open-${index}`">{{ row.title || '제목 없음' }}</NuxtLink>
        </div>
        <p v-else class="flex min-h-11 items-center text-sm text-dimmed" data-testid="ext-backlinks-empty">이 메모를 참조하는 공개 메모가 없습니다.</p>
      </section>
    </article>
  </main>
</template>
