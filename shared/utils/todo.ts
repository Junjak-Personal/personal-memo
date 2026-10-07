/**
 * 할 일 (frontmatter `done`, 2026-10-08). 키 없음 = 메모, `done: false` = 안 끝난 할 일, `done: true` = 끝난 할 일.
 * 끝난 할 일은 일정이 아니다 — 앱 캘린더의 「일정」과 구글 캘린더에서 빠진다(「이날 만든 메모」에는 남는다).
 */
import type { MemoMeta } from '../types/memo'

/** 「할 일」 화면에서 바로 추가한 할 일이 들어가는 폴더. 메모 메뉴로 할 일이 된 메모는 제자리에 있다 */
export const TODO_FOLDER = '할 일'

/** 캘린더에 일정으로 보이는가 — 앱 캘린더, 구글 대조, 저장 직후 알림이 이 한 규칙을 쓴다 */
export function isScheduled<T extends Pick<MemoMeta, 'date' | 'done'>>(memo: T): memo is T & { date: string } {
  return memo.date !== null && memo.done !== true
}

/** 날짜 있는 것이 먼저(가까운 날부터, 같으면 제목), 날짜 없는 것은 최근에 만든 것부터 — 방금 추가한 것이 입력칸 가까이 */
export function compareTodos(a: Pick<MemoMeta, 'title' | 'date' | 'created'>, b: Pick<MemoMeta, 'title' | 'date' | 'created'>) {
  if (a.date && b.date) return a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ko')
  if (a.date) return -1
  if (b.date) return 1
  return (b.created ?? '').localeCompare(a.created ?? '') || a.title.localeCompare(b.title, 'ko')
}
