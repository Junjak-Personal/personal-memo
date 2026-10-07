<script setup lang="ts">
/**
 * 구글 캘린더 연동 상태 (설계문서 §8.3). 조용히 실패하지 않게 — 실패·보류는 이유와 함께 보이고 여기서 다시 시도한다.
 * 미뤄 둔 대량 삭제는 사람이 확인해야만 진행한다.
 */
const props = defineProps<{ titleOf: (memoId: string) => string | null }>()

const toast = useToast()
const calendarSync = useCalendarSyncStatus()

const confirmOpen = ref(false)

const status = computed(() => calendarSync.status.value)
const failures = computed(() => (status.value?.state === 'on' ? Object.entries(status.value.failures) : []))
const timeFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Seoul' })

function at(iso: string | null) {
  return iso ? timeFormat.format(new Date(iso)) : '아직 없음'
}

async function run(allowMassDelete = false) {
  try {
    await calendarSync.runNow(allowMassDelete)
    confirmOpen.value = false
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '캘린더를 맞추지 못했습니다') })
  }
}
</script>

<template>
  <div class="flex flex-col gap-2 border-t border-default p-4 text-xs" data-testid="calendar-sync-panel">
    <div class="flex items-center gap-1.5 font-medium text-default">
      <UIcon name="i-material-symbols-sync" class="size-4 text-muted" :class="calendarSync.running.value && 'animate-spin'" />
      구글 캘린더
    </div>

    <p v-if="!status" class="text-muted">상태를 불러오지 못했습니다</p>

    <p v-else-if="status.state !== 'on'" :class="status.state === 'broken' ? 'text-error' : 'text-muted'" data-testid="calendar-sync-off">
      {{ status.message }}
    </p>

    <template v-else>
      <p v-if="status.error" class="text-error" data-testid="calendar-sync-error">맞추지 못했습니다 — {{ status.error }}</p>

      <div v-if="status.held" class="flex flex-col gap-1 rounded-md border border-warning/50 p-2 text-warning" data-testid="calendar-sync-held">
        <p v-if="status.held.reason === 'empty'">
          메모가 하나도 없어 캘린더의 메모 일정 {{ status.held.deletes }}개를 지우지 않았습니다. 데이터 폴더가 제대로 붙어 있는지 먼저 확인하세요.
        </p>
        <p v-else>
          한 번에 일정 {{ status.held.deletes }}개(캘린더의 메모 일정 {{ status.held.existing }}개 중)를 지우게 되어 멈췄습니다.
        </p>
      </div>

      <div v-if="failures.length" class="flex flex-col gap-0.5 text-error" data-testid="calendar-sync-failures">
        <p>반영하지 못한 메모 {{ failures.length }}개</p>
        <ul class="list-inside list-disc text-muted">
          <li v-for="[id, message] in failures.slice(0, 5)" :key="id" class="truncate" :title="message">
            {{ props.titleOf(id) ?? id }} — {{ message }}
          </li>
        </ul>
      </div>

      <p class="text-muted">마지막으로 맞춘 때: {{ at(status.lastOkAt) }}</p>
    </template>

    <div v-if="status?.state === 'on'" class="flex flex-wrap justify-end gap-2">
      <UButton
        v-if="status.held"
        color="error"
        variant="outline"
        size="xs"
        data-testid="calendar-sync-allow-delete"
        @click="confirmOpen = true"
      >
        확인하고 지우기
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        size="xs"
        icon="i-material-symbols-sync"
        :loading="calendarSync.running.value"
        data-testid="calendar-sync-run"
        @click="run()"
      >
        지금 맞추기
      </UButton>
    </div>

    <UModal v-model:open="confirmOpen" title="캘린더에서 일정을 지울까요?">
      <template #body>
        <p v-if="status?.state === 'on' && status.held" class="text-sm text-muted">
          메모 쪽에서 사라진 일정 {{ status.held.deletes }}개를 구글 캘린더에서 지웁니다. 메모를 일부러 지우거나 날짜를 뺀 것이
          맞을 때만 진행하세요. 지운 일정은 되돌릴 수 없습니다 — 메모를 되살리면 새 일정으로 다시 만들어집니다.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="confirmOpen = false">취소</UButton>
          <UButton color="error" :loading="calendarSync.running.value" data-testid="calendar-sync-confirm-delete" @click="run(true)">
            지우기
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
