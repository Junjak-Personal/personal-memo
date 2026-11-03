<script setup lang="ts">
import type { PublicFolderNode } from '#shared/types/memo'

const props = defineProps<{ folderId: string }>()
const { data: folder, status, error, refresh } = useAsyncData(
  `ext-folder:${props.folderId}`,
  () => $fetch<PublicFolderNode>(`/api/ext/folders/${encodeURIComponent(props.folderId)}`),
  { getCachedData: () => undefined },
)

useHead({
  title: () => folder.value?.name || '공개 폴더',
  meta: [{ name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }],
})
</script>

<template>
  <main class="mx-auto w-full max-w-4xl px-4 py-10 sm:px-14">
    <div v-if="status === 'pending'" class="space-y-6" role="status" aria-label="공개 폴더를 불러오는 중" data-testid="ext-folder-loading">
      <USkeleton class="h-9 w-2/3" />
      <USkeleton v-for="index in 3" :key="index" class="h-14 w-full" />
    </div>
    <div v-else-if="error || !folder" class="flex min-h-80 flex-col items-center justify-center gap-4 text-center" data-testid="ext-folder-missing">
      <UIcon name="i-material-symbols-lock-outline" class="size-10 text-dimmed" />
      <p class="text-muted">{{ apiStatus(error) === 404 ? '공개되지 않았거나 없는 폴더입니다' : apiMessage(error, '폴더를 열지 못했습니다') }}</p>
      <UButton v-if="apiStatus(error) !== 404" color="neutral" variant="outline" data-testid="ext-folder-retry" @click="refresh()">다시 시도</UButton>
    </div>
    <template v-else>
      <header class="mb-8">
        <div class="mb-3 flex items-center gap-2 text-sm text-muted"><UIcon name="i-material-symbols-folder-outline" class="size-5" />공개 폴더</div>
        <h1 class="text-3xl font-bold break-words" data-testid="ext-folder-title">{{ folder.name }}</h1>
      </header>
      <div v-if="!folder.children.length && !folder.memos.length" class="rounded-md border border-default px-4 py-10 text-center text-sm text-muted" data-testid="ext-folder-empty">아직 메모가 없는 폴더입니다.</div>
      <div v-else class="space-y-8">
        <section v-if="folder.children.length" aria-label="하위 폴더">
          <h2 class="mb-3 text-sm font-medium text-muted">폴더</h2>
          <div class="flex flex-col gap-2">
            <NuxtLink v-for="(child, index) in folder.children" :key="child.id" :to="`/ext/folder/${encodeURIComponent(child.id)}`" class="flex min-h-12 items-center gap-3 rounded-md border border-default px-4 py-3 hover:bg-elevated" :data-testid="`ext-folder-child-open-${index}`">
              <UIcon name="i-material-symbols-folder-outline" class="size-5 shrink-0 text-primary" /><span class="min-w-0 flex-1 break-words">{{ child.name }}</span><UIcon name="i-material-symbols-chevron-right" class="size-5 shrink-0 text-muted" />
            </NuxtLink>
          </div>
        </section>
        <section v-if="folder.memos.length" aria-label="폴더 안 메모">
          <h2 class="mb-3 text-sm font-medium text-muted">메모</h2>
          <div class="flex flex-col gap-2">
            <NuxtLink v-for="(memo, index) in folder.memos" :key="memo.id" :to="`/ext/${encodeURIComponent(memo.id)}`" class="flex min-h-12 items-center gap-3 rounded-md border border-default px-4 py-3 hover:bg-elevated" :data-testid="`ext-folder-memo-open-${index}`">
              <UIcon name="i-material-symbols-description-outline" class="size-5 shrink-0 text-muted" /><span class="min-w-0 flex-1 break-words">{{ memo.title || '제목 없음' }}</span><UIcon name="i-material-symbols-chevron-right" class="size-5 shrink-0 text-muted" />
            </NuxtLink>
          </div>
        </section>
      </div>
    </template>
  </main>
</template>
