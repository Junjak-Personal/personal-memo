<script setup lang="ts">
/**
 * 완료 목록 (설계문서 §3.5, 2026-10-16) — 끝낸 할 일을 폴더와 상관없이 모아 본다. 사이드바 「할 일」 폴더 메뉴의 「완료 목록 보기」로 온다.
 * 사이드바의 「할 일」 폴더는 끝낸 할 일을 숨기므로 여기서 찾는다.
 * 체크를 풀면 안 끝난 할 일로 돌아간다 — 이 화면을 떠날 때까지는 줄을 지운 채 남겨 잘못 눌렀으면 바로 다시 체크할 수 있다.
 */
import type { MemoMeta } from '#shared/types/memo'
import { compareDoneTodos, TODO_FOLDER } from '#shared/utils/todo'

const { tree, error } = useMemoTree()
const todo = useTodo()

/** 이 화면에서 체크를 푼 할 일 — 떠날 때까지 목록에 남긴다 */
const reopenedHere = ref<string[]>([])

const items = computed(() =>
  (tree.value?.memos ?? []).filter((m) => m.done === true || (m.done === false && reopenedHere.value.includes(m.id))).sort(compareDoneTodos),
)
const doneCount = computed(() => items.value.filter((m) => m.done === true).length)

function dateLabel(memo: MemoMeta) {
  if (!memo.date) return null
  return memo.dateEnd ? `${formatDay(memo.date)} ~ ${formatDay(memo.dateEnd)}` : formatDay(memo.date)
}

async function toggle(memo: MemoMeta) {
  const next = memo.done !== true
  if (!next && !reopenedHere.value.includes(memo.id)) reopenedHere.value = [...reopenedHere.value, memo.id]
  await todo.setDone(memo.id, next)
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
    <Teleport to="#app-header-title" defer>완료 목록</Teleport>
    <Teleport to="#app-header-actions" defer>
      <span class="text-sm text-muted" data-testid="todo-done-count">{{ doneCount }}개 끝냄</span>
    </Teleport>

    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <p class="text-xs text-muted">체크를 풀면 「할 일」로 돌아갑니다.</p>

      <p v-if="error" class="py-20 text-center text-error">{{ error }}</p>
      <div v-else-if="tree && !items.length" class="flex flex-col items-center gap-3 py-20 text-center text-muted" data-testid="todo-done-empty">
        <UIcon name="i-material-symbols-task-alt" class="size-10 text-dimmed" />
        끝낸 할 일이 없습니다
      </div>
      <ul v-else class="flex flex-col divide-y divide-default" data-testid="todo-done-list">
        <li v-for="memo in items" :key="memo.id" class="flex items-center gap-3 py-2.5" :data-testid="`todo-done-item-${memo.id}`">
          <UCheckbox
            :model-value="memo.done === true"
            :disabled="todo.pending.value.includes(memo.id)"
            :aria-label="memo.done ? '안 끝난 것으로 되돌리기' : '끝냄'"
            size="lg"
            data-testid="todo-done-check"
            @update:model-value="toggle(memo)"
          />
          <NuxtLink :to="memoPath(memo.id)" class="min-w-0 flex-1">
            <p class="truncate" :class="memo.done ? 'text-muted line-through' : 'font-medium'">{{ memo.title || '제목 없음' }}</p>
            <p v-if="memo.date || memo.folder !== TODO_FOLDER" class="truncate text-xs text-muted">
              <span v-if="memo.date">{{ dateLabel(memo) }}</span>
              <span v-if="memo.date && memo.folder !== TODO_FOLDER"> · </span>
              <span v-if="memo.folder !== TODO_FOLDER">{{ memo.folder || '최상위' }}</span>
            </p>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
