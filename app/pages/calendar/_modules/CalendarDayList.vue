<script setup lang="ts">
/** 고른 날의 메모 — 그날에 걸친 일정, 그날 만든 메모 (설계문서 §8.4). 휴지통 메모는 서버가 이미 뺐다 */
import type { MemoMeta } from '#shared/types/memo'

defineProps<{ day: string; scheduled: MemoMeta[]; created: MemoMeta[] }>()

const dayFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' })

/** `YYYY-MM-DD` 는 시각 없이 «그 지역의 0시»로 읽어야 하루가 밀리지 않는다 */
function local(day: string) {
  return new Date(`${day}T00:00:00`)
}

/** `10월 15일 ~ 22일`, 달이 다르면 `10월 30일 ~ 11월 2일` */
function rangeLabel(memo: MemoMeta) {
  if (!memo.date) return ''
  if (!memo.dateEnd) return '하루'
  const md = (day: string) => `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일`
  const end = memo.dateEnd.slice(0, 7) === memo.date.slice(0, 7) ? `${Number(memo.dateEnd.slice(8))}일` : md(memo.dateEnd)
  return `${md(memo.date)} ~ ${end}`
}

function createdTime(memo: MemoMeta) {
  return memo.created ? timeFormat.format(new Date(memo.created)) : ''
}

function linkOf(memo: MemoMeta) {
  return `/m/${encodeURIComponent(memo.id)}`
}
</script>

<template>
  <div class="flex flex-col gap-4 p-4" data-testid="calendar-day-list">
    <h2 class="text-sm font-semibold text-highlighted">{{ dayFormat.format(local(day)) }}</h2>

    <section v-if="scheduled.length" class="flex flex-col gap-1">
      <h3 class="flex items-center gap-1.5 text-xs text-muted">
        <span class="h-2 w-3 rounded-sm bg-primary/40" />
        일정
      </h3>
      <NuxtLink
        v-for="memo in scheduled"
        :key="memo.id"
        :to="linkOf(memo)"
        class="flex flex-col rounded-md px-2 py-1.5 transition-colors hover:bg-elevated"
        :data-testid="`calendar-scheduled-${memo.id}`"
      >
        <span class="truncate text-sm text-default">{{ memo.title || '제목 없음' }}</span>
        <span class="truncate text-xs text-muted">{{ rangeLabel(memo) }} · {{ memo.folder || '최상위' }}</span>
      </NuxtLink>
    </section>

    <section v-if="created.length" class="flex flex-col gap-1">
      <h3 class="flex items-center gap-1.5 text-xs text-muted">
        <span class="size-1.5 rounded-full bg-(--ui-text-muted)" />
        이날 만든 메모
      </h3>
      <NuxtLink
        v-for="memo in created"
        :key="memo.id"
        :to="linkOf(memo)"
        class="flex flex-col rounded-md px-2 py-1.5 transition-colors hover:bg-elevated"
        :data-testid="`calendar-created-memo-${memo.id}`"
      >
        <span class="truncate text-sm text-default">{{ memo.title || '제목 없음' }}</span>
        <span class="truncate text-xs text-muted">{{ createdTime(memo) }} · {{ memo.folder || '최상위' }}</span>
      </NuxtLink>
    </section>

    <p v-if="!scheduled.length && !created.length" class="text-sm text-muted">이날은 메모가 없습니다</p>
  </div>
</template>
