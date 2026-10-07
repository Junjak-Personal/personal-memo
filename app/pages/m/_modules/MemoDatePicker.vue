<script setup lang="ts">
/**
 * 날짜 — 종일 하루 또는 기간 (설계문서 §8). 첫 클릭이 하루, 두 번째 클릭이 기간의 끝.
 * 날짜는 시간대 없는 CalendarDate 로만 다룬다 — JS Date 로 바꾸면 UTC 에서 하루 밀린다.
 */
import { parseDate } from '@internationalized/date'
import type { DateRange } from 'reka-ui'

const props = defineProps<{ date: string | null; dateEnd: string | null; disabled?: boolean }>()

const emit = defineEmits<{ change: [date: string | null, dateEnd: string | null] }>()

const open = ref(false)
/**
 * 🔴 팝오버가 열려 있는 동안은 캘린더가 자기 선택 상태를 들고 있어야 한다.
 *    props 에서 매번 다시 만들면 첫 클릭(하루)이 「20~20」 완성 범위로 되돌아와, 두 번째 클릭이 끝이 아니라
 *    «새 범위의 시작»이 된다 (20 → 22 를 눌렀는데 22 하루로 저장된 버그).
 */
const draft = shallowRef<DateRange>({ start: undefined, end: undefined })

const label = computed(() => {
  if (!props.date) return '날짜 없음'
  return props.dateEnd ? `${formatDay(props.date)} ~ ${formatDay(props.dateEnd)}` : formatDay(props.date)
})

function onOpen(value: boolean) {
  if (value) {
    draft.value = {
      start: props.date ? parseDate(props.date) : undefined,
      end: props.date ? parseDate(props.dateEnd ?? props.date) : undefined,
    }
  }
  open.value = value
}

function onSelect(value: DateRange | null) {
  draft.value = value ?? { start: undefined, end: undefined }
  const start = value?.start?.toString() ?? null
  const end = value?.end?.toString() ?? null
  // 하루짜리는 끝 날짜를 두지 않는다 (서버 규칙과 같다)
  emit('change', start, end && end !== start ? end : null)
}

function clear() {
  emit('change', null, null)
  open.value = false
}
</script>

<template>
  <UPopover :open="open" :content="{ align: 'start' }" @update:open="onOpen">
    <UButton
      icon="i-material-symbols-calendar-today-outline"
      color="neutral"
      variant="outline"
      size="sm"
      :disabled="disabled"
      data-testid="memo-date-button"
    >
      {{ label }}
    </UButton>

    <template #content>
      <div class="flex flex-col gap-2 p-2">
        <UCalendar range :model-value="draft" :week-starts-on="0" @update:model-value="onSelect" />
        <p class="px-1 text-xs text-muted">한 번 누르면 하루, 한 번 더 누르면 기간입니다</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" size="sm" :disabled="!date" data-testid="memo-date-clear" @click="clear">
            날짜 지우기
          </UButton>
          <UButton size="sm" data-testid="memo-date-done" @click="open = false">확인</UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
