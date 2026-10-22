<script setup lang="ts">
/**
 * 할 일 (설계문서 §3.5) — 안 끝난 할 일을 모아 본다. 할 일은 「할 일」 폴더에만 있고, 여기서 추가한 것도 거기에 생긴다.
 * 목록은 사이드바 트리에서 고른다 — 따로 불러오지 않는다(체크·추가가 트리를 바꾸면 여기도 바로 바뀐다).
 * 이 화면에서 끝낸 것은 떠날 때까지 줄을 그은 채 남긴다 — 잘못 눌렀으면 바로 되돌릴 수 있게.
 * 순서는 정해져 있다 (2026-10-22) — 날짜 빠른 순, 날짜 없는 것은 맨 아래, 같은 날짜 안에서는 중요도 상 → 중 → 하 (compareOpenTodos).
 */
import type { MemoMeta, TodoPriority } from '#shared/types/memo'
import { todayKst } from '#shared/utils/memo-date'
import { compareOpenTodos, TODO_FOLDER } from '#shared/utils/todo'
import TodoPriorityMenu from './TodoPriorityMenu.vue'

const toast = useToast()
const { tree, error } = useMemoTree()
const todo = useTodo()

const titleInput = ref('')
/** 새 할 일의 날짜 — 기본은 오늘. 추가한 뒤에도 그대로 둔다(같은 날 할 일을 이어서 넣기 좋게). 지우면 날짜 없는 할 일 */
const newDate = ref<string | null>(todayKst())
const newDateEnd = ref<string | null>(null)
/** 새 할 일의 중요도 — 추가한 뒤에는 중으로 되돌린다 */
const newPriority = ref<TodoPriority>('medium')
const adding = ref(false)
/** 이 화면에서 끝낸 할 일 — 떠날 때까지 목록에 남긴다 */
const finishedHere = ref<string[]>([])

const items = computed(() =>
  (tree.value?.memos ?? [])
    .filter((m) => m.done === false || (m.done === true && finishedHere.value.includes(m.id)))
    .sort(compareOpenTodos),
)
const openCount = computed(() => items.value.filter((m) => m.done === false).length)

const today = todayKst()

function overdue(memo: MemoMeta) {
  return memo.done === false && memo.date !== null && (memo.dateEnd ?? memo.date) < today
}

function dateLabel(memo: MemoMeta) {
  if (!memo.date) return null
  return memo.dateEnd ? `${formatDay(memo.date)} ~ ${formatDay(memo.dateEnd)}` : formatDay(memo.date)
}

async function add() {
  const title = titleInput.value.trim()
  if (!title || adding.value) return
  adding.value = true
  try {
    await todo.addTodo(title, newDate.value, newDateEnd.value, newPriority.value)
    titleInput.value = ''
    newPriority.value = 'medium'
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '할 일을 추가하지 못했습니다') })
  } finally {
    adding.value = false
  }
}

function onNewDate(date: string | null, dateEnd: string | null) {
  newDate.value = date
  newDateEnd.value = dateEnd
}

async function toggle(memo: MemoMeta) {
  const next = memo.done !== true
  if (next && !finishedHere.value.includes(memo.id)) finishedHere.value = [...finishedHere.value, memo.id]
  await todo.setDone(memo.id, next)
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
    <Teleport to="#app-header-title" defer>할 일</Teleport>
    <Teleport to="#app-header-actions" defer>
      <span class="text-sm text-muted" data-testid="todo-open-count">{{ openCount }}개 남음</span>
    </Teleport>

    <div class="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <form class="flex gap-2" @submit.prevent="add">
        <UInput
          v-model="titleInput"
          icon="i-material-symbols-add-task"
          placeholder="할 일 추가"
          :maxlength="200"
          class="flex-1"
          data-testid="todo-add-input"
        />
        <UButton type="submit" :loading="adding" :disabled="!titleInput.trim()" data-testid="todo-add-button">추가</UButton>
        <MemoDatePicker :date="newDate" :date-end="newDateEnd" size="md" test-id="todo-date" @change="onNewDate" />
        <TodoPriorityMenu :priority="newPriority" size="md" test-id="todo-add-priority" @pick="newPriority = $event" />
      </form>
      <p class="-mt-2 text-xs text-muted">「{{ TODO_FOLDER }}」 폴더에 생깁니다. 다른 메모는 메모 메뉴의 「할 일로 두기」나 그 폴더로 옮기면 할 일이 됩니다.
        날짜순으로, 같은 날짜는 중요도순으로 놓이고 날짜 없는 할 일은 맨 아래에 둡니다.
      </p>

      <p v-if="error" class="py-20 text-center text-error">{{ error }}</p>
      <div v-else-if="tree && !items.length" class="flex flex-col items-center gap-3 py-20 text-center text-muted" data-testid="todo-empty">
        <UIcon name="i-material-symbols-task-alt" class="size-10 text-dimmed" />
        남은 할 일이 없습니다
      </div>
      <ul v-else class="flex flex-col divide-y divide-default" data-testid="todo-list">
        <li v-for="memo in items" :key="memo.id" class="flex items-center gap-3 py-2.5" :data-testid="`todo-item-${memo.id}`">
          <UCheckbox
            :model-value="memo.done === true"
            :disabled="todo.pending.value.includes(memo.id)"
            :aria-label="memo.done ? '안 끝난 것으로 되돌리기' : '끝냄'"
            size="lg"
            data-testid="todo-check"
            @update:model-value="toggle(memo)"
          />
          <NuxtLink :to="memoPath(memo.id)" class="min-w-0 flex-1">
            <p class="truncate" :class="memo.done ? 'text-muted line-through' : 'font-medium'">{{ memo.title || '제목 없음' }}</p>
            <p v-if="memo.date" class="truncate text-xs text-muted">
              <span :class="overdue(memo) && 'text-error'">{{ dateLabel(memo) }}</span>
            </p>
          </NuxtLink>
          <TodoPriorityMenu
            :priority="memo.priority"
            :disabled="memo.done === true || todo.pending.value.includes(memo.id)"
            test-id="todo-priority"
            @pick="todo.setPriority(memo.id, $event)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
