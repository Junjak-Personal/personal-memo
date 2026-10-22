/**
 * 할 일 (frontmatter `done`, 2026-10-08). 키 없음 = 메모, `done: false` = 안 끝난 할 일, `done: true` = 끝난 할 일.
 * 끝난 할 일은 일정이 아니다 — 앱 캘린더의 「일정」과 구글 캘린더에서 빠진다(「이날 만든 메모」에는 남는다).
 *
 * 할 일과 「할 일」 폴더는 함께 간다 (2026-10-22 사용자 요청) — 할 일은 「할 일」 폴더 바로 아래에만 있다.
 * 할 일로 두면 그 폴더로 옮기고, 풀면 최상위로 옮긴다. 메모를 그 폴더로 옮기면 할 일이 되고, 밖으로 옮기면 일반 메모가 된다.
 */
import type { MemoMeta, TodoPriority } from '../types/memo'

/** 할 일이 사는 폴더. 「할 일」 화면에서 바로 추가한 할 일도 여기에 생긴다 */
export const TODO_FOLDER = '할 일'

/** 위에서부터 — 같은 날짜 안의 정렬 순서 */
export const TODO_PRIORITIES = ['high', 'medium', 'low'] as const satisfies readonly TodoPriority[]

export const PRIORITY_LABEL = { high: '상', medium: '중', low: '하' } satisfies Record<TodoPriority, string>

export function isTodoPriority(value: unknown): value is TodoPriority {
  return typeof value === 'string' && (TODO_PRIORITIES as readonly string[]).includes(value)
}

/** 캘린더에 일정으로 보이는가 — 앱 캘린더, 구글 대조, 저장 직후 알림이 이 한 규칙을 쓴다 */
export function isScheduled<T extends Pick<MemoMeta, 'date' | 'done'>>(memo: T): memo is T & { date: string } {
  return memo.date !== null && memo.done !== true
}

/** 이 폴더에 놓인 메모의 할 일 상태 — 「할 일」 폴더면 할 일(끝냈으면 그대로), 아니면 일반 메모 */
export function doneInFolder(done: boolean | null, folder: string) {
  return folder === TODO_FOLDER ? (done ?? false) : null
}

/**
 * 「할 일」 화면 순서 (2026-10-22) — 1차 날짜(시작일) 빠른 순, 날짜 없는 것은 맨 아래. 2차 중요도 상 → 중 → 하.
 * 그다음은 만든 시각 최근순, 제목순. 손으로 바꾸는 순서는 없다.
 */
export function compareOpenTodos(
  a: Pick<MemoMeta, 'title' | 'date' | 'priority' | 'created'>,
  b: Pick<MemoMeta, 'title' | 'date' | 'priority' | 'created'>,
) {
  if (a.date !== b.date) {
    if (a.date === null) return 1
    if (b.date === null) return -1
    return a.date.localeCompare(b.date)
  }
  return (
    TODO_PRIORITIES.indexOf(a.priority) - TODO_PRIORITIES.indexOf(b.priority) ||
    (b.created ?? '').localeCompare(a.created ?? '') ||
    a.title.localeCompare(b.title, 'ko')
  )
}

/** 완료 목록 — 날짜(없으면 만든 날)가 최근인 것부터. 끝낸 시각은 따로 남기지 않는다(체크는 updated 를 바꾸지 않는다) */
export function compareDoneTodos(a: Pick<MemoMeta, 'title' | 'date' | 'created'>, b: Pick<MemoMeta, 'title' | 'date' | 'created'>) {
  const ka = (a.date ?? a.created ?? '').slice(0, 10)
  const kb = (b.date ?? b.created ?? '').slice(0, 10)
  return kb.localeCompare(ka) || (b.created ?? '').localeCompare(a.created ?? '') || a.title.localeCompare(b.title, 'ko')
}
