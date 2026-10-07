<script setup lang="ts">
/**
 * 캘린더 — 월 보기 하나 (설계문서 §8.4). 일정(date ~ date_end)은 막대, 만든 날은 날짜 옆 점·개수.
 * 보고 있는 달과 고른 날은 주소(?m=2026-10&d=2026-10-07)에 둔다 — 메모를 열었다가 뒤로 오면 그 자리로 돌아온다.
 */
import type { CalendarResponse, MemoMeta } from '#shared/types/memo'
import { isDateString, todayKst } from '#shared/utils/memo-date'
import CalendarDayList from './CalendarDayList.vue'
import CalendarSyncPanel from './CalendarSyncPanel.vue'
import CalendarWeek from './CalendarWeek.vue'
import { groupByCreatedDay, isMonthString, layoutWeek, monthWeeks, scheduledOn, shiftMonth } from './month-layout'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const route = useRoute()
const router = useRouter()
const calendarSync = useCalendarSyncStatus()

const today = todayKst()
const month = computed(() => {
  const m = route.query.m
  return typeof m === 'string' && isMonthString(m) ? m : today.slice(0, 7)
})
const selected = computed(() => {
  const d = route.query.d
  if (typeof d === 'string' && isDateString(d)) return d
  return today.startsWith(month.value) ? today : `${month.value}-01`
})
const weeks = computed(() => monthWeeks(month.value))
const range = computed(() => ({ from: weeks.value[0]![0]!, to: weeks.value.at(-1)!.at(-1)! }))

const { data, status, error } = await useFetch<CalendarResponse>('/api/calendar', { query: range })

const scheduled = computed(() => data.value?.scheduled ?? [])
const createdByDay = computed(() => groupByCreatedDay(data.value?.created ?? []))
const layouts = computed(() => weeks.value.map((days) => layoutWeek(days, scheduled.value)))
const monthLabel = computed(() => `${month.value.slice(0, 4)}년 ${Number(month.value.slice(5))}월`)
const selectedScheduled = computed(() => scheduledOn(selected.value, scheduled.value))
const selectedCreated = computed(() => createdByDay.value.get(selected.value) ?? [])

onMounted(() => {
  void calendarSync.refresh()
})

function go(m: string, d?: string) {
  void router.replace({ query: d ? { m, d } : { m } })
}

function select(day: string) {
  go(month.value, day)
}

function createdCount(day: string) {
  return createdByDay.value.get(day)?.length ?? 0
}

/** 상태 칸이 실패한 메모를 제목으로 보이게 — 이 달에 보이는 것만 안다 */
function titleOf(memoId: string) {
  const all: MemoMeta[] = [...scheduled.value, ...(data.value?.created ?? [])]
  return all.find((m) => m.id === memoId)?.title ?? null
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col lg:min-h-0">
    <Teleport to="#app-header-title" defer>{{ monthLabel }}</Teleport>
    <Teleport to="#app-header-actions" defer>
      <UButton color="neutral" variant="outline" size="sm" data-testid="calendar-today-button" @click="go(today.slice(0, 7), today)">
        오늘
      </UButton>
      <UButton
        icon="i-material-symbols-chevron-left"
        color="neutral"
        variant="ghost"
        aria-label="이전 달"
        data-testid="calendar-prev-button"
        @click="go(shiftMonth(month, -1))"
      />
      <UButton
        icon="i-material-symbols-chevron-right"
        color="neutral"
        variant="ghost"
        aria-label="다음 달"
        data-testid="calendar-next-button"
        @click="go(shiftMonth(month, 1))"
      />
    </Teleport>

    <div class="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
      <section class="flex flex-col lg:min-h-0 lg:flex-1 lg:overflow-y-auto" :aria-busy="status === 'pending'">
        <div class="sticky top-0 z-10 grid grid-cols-7 border-b border-default bg-default">
          <span
            v-for="(weekday, index) in WEEKDAYS"
            :key="weekday"
            class="py-1.5 text-center text-xs"
            :class="index === 0 ? 'text-error' : 'text-muted'"
          >
            {{ weekday }}
          </span>
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-material-symbols-error-outline"
          :title="apiMessage(error, '캘린더를 불러오지 못했습니다')"
          class="m-4"
        />

        <div class="flex flex-1 flex-col transition-opacity" :class="status === 'pending' && 'opacity-60'">
          <CalendarWeek
            v-for="layout in layouts"
            :key="layout.days[0]"
            :layout="layout"
            :month="month"
            :today="today"
            :selected="selected"
            :created-count="createdCount"
            class="min-h-24 flex-1 lg:min-h-28"
            @select="select"
          />
        </div>
      </section>

      <aside class="flex flex-col border-t border-default lg:w-80 lg:shrink-0 lg:overflow-y-auto lg:border-t-0 lg:border-s">
        <CalendarDayList :day="selected" :scheduled="selectedScheduled" :created="selectedCreated" />
        <CalendarSyncPanel class="mt-auto" :title-of="titleOf" />
      </aside>
    </div>
  </div>
</template>
