<script setup lang="ts">
/**
 * 월 보기의 한 주 — 템플릿 MonthWeek 의 격자 구조를 따른다 (설계문서 §8.4).
 * 첫 줄은 날짜 숫자와 「이날 만든 메모」 점, 그 아래 MAX_LANES 줄은 일정 막대, 마지막 칸은 「+N」.
 * 끌어서 만들기·옮기기·팝오버는 없다 — 일정은 메모 쪽에서만 고친다.
 */
import { weekdayOf } from '#shared/utils/memo-date'
import { MAX_LANES, type WeekLayout } from './month-layout'

const props = defineProps<{
  layout: WeekLayout
  /** 보고 있는 달 `YYYY-MM` — 앞뒤 달 날짜는 흐리게 */
  month: string
  today: string
  selected: string
  createdCount: (day: string) => number
}>()

const emit = defineEmits<{ select: [day: string] }>()

const gridStyle = {
  gridTemplateRows: `auto repeat(${MAX_LANES}, var(--bar-h)) minmax(var(--bar-h), 1fr)`,
}

function numberClass(day: string) {
  if (day === props.today) return 'bg-primary text-inverted'
  if (!day.startsWith(props.month)) return 'text-dimmed'
  return weekdayOf(day) === 0 ? 'text-error' : 'text-default'
}

function dayLabel(day: string) {
  const created = props.createdCount(day)
  return `${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일${created ? `, 만든 메모 ${created}개` : ''}`
}
</script>

<template>
  <div class="grid grid-cols-7 border-b border-default [--bar-h:1.125rem] lg:[--bar-h:1.375rem]" :style="gridStyle">
    <!-- 칸 전체가 날짜 고르기 단추다. 막대·숫자는 그 위에 얹힌다 -->
    <button
      v-for="(day, index) in layout.days"
      :key="`cell-${day}`"
      type="button"
      class="row-span-full border-default transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :class="[index !== 0 && 'border-s', day === selected ? 'bg-elevated' : 'hover:bg-elevated/50']"
      :style="{ gridColumn: index + 1 }"
      :aria-label="dayLabel(day)"
      :aria-pressed="day === selected"
      :data-testid="`calendar-day-${day}`"
      @click="emit('select', day)"
    />

    <div
      v-for="(day, index) in layout.days"
      :key="`number-${day}`"
      class="pointer-events-none row-start-1 flex min-w-0 items-center gap-1 px-1 pt-1 pb-0.5"
      :style="{ gridColumn: index + 1 }"
    >
      <span class="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold" :class="numberClass(day)">
        {{ Number(day.slice(8)) }}
      </span>
      <span
        v-if="createdCount(day)"
        class="flex items-center gap-0.5 text-[10px] leading-none text-muted"
        :data-testid="`calendar-created-${day}`"
      >
        <span class="size-1.5 rounded-full bg-(--ui-text-muted)" />
        <span v-if="createdCount(day) > 1">{{ createdCount(day) }}</span>
      </span>
    </div>

    <NuxtLink
      v-for="bar in layout.bars"
      :key="bar.memo.id"
      :to="`/m/${encodeURIComponent(bar.memo.id)}`"
      class="mx-0.5 flex h-[calc(var(--bar-h)-2px)] min-w-0 items-center self-center rounded bg-primary/15 px-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/25 dark:bg-primary/25 dark:hover:bg-primary/35 lg:text-xs"
      :class="[bar.continuesBefore && 'ms-0 rounded-s-none', bar.continuesAfter && 'me-0 rounded-e-none']"
      :style="{ gridColumn: `${bar.colStart + 1} / span ${bar.colSpan}`, gridRow: bar.lane + 2 }"
      :title="bar.memo.title"
      :data-testid="`calendar-bar-${bar.memo.id}`"
    >
      <span class="truncate">{{ bar.memo.title || '제목 없음' }}</span>
    </NuxtLink>

    <template v-for="(count, index) in layout.hidden" :key="`more-${index}`">
      <button
        v-if="count"
        type="button"
        class="mx-0.5 self-start justify-self-start rounded border border-default px-1 text-[10px] leading-4 text-muted transition-colors hover:bg-elevated lg:text-xs"
        :style="{ gridColumn: index + 1, gridRow: MAX_LANES + 2 }"
        :aria-label="`${dayLabel(layout.days[index]!)} 일정 ${count}개 더 보기`"
        @click="emit('select', layout.days[index]!)"
      >
        +{{ count }}
      </button>
    </template>
  </div>
</template>
