<script setup lang="ts">
/**
 * 「캘린더 반영 실패」 (설계문서 §8.3). 메모 저장은 성공했지만 구글 캘린더에 못 넣은 경우에만 보인다.
 * 누르면 지금 다시 맞춘다. 연동이 꺼져 있으면 아무것도 보이지 않는다.
 */
const props = defineProps<{ memoId: string; hasDate: boolean }>()

const toast = useToast()
const calendarSync = useCalendarSyncStatus()

const failure = computed(() => calendarSync.failureOf(props.memoId, props.hasDate))

async function retry() {
  try {
    await calendarSync.runNow()
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '캘린더를 맞추지 못했습니다') })
    return
  }
  const still = calendarSync.failureOf(props.memoId, props.hasDate)
  toast.add(still ? { color: 'error', title: '아직 반영하지 못했습니다', description: still } : { title: '캘린더에 반영했습니다' })
}
</script>

<template>
  <UTooltip v-if="failure" :text="failure">
    <UButton
      icon="i-material-symbols-event-busy-outline"
      color="error"
      variant="outline"
      size="xs"
      :loading="calendarSync.running.value"
      data-testid="memo-calendar-sync-retry"
      @click="retry"
    >
      캘린더 반영 실패
    </UButton>
  </UTooltip>
</template>
