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

/** 완료 목록 — 날짜(없으면 만든 날)가 최근인 것부터. 끝낸 시각은 따로 남기지 않는다(체크는 updated 를 바꾸지 않는다) */
export function compareDoneTodos(a: Pick<MemoMeta, 'title' | 'date' | 'created'>, b: Pick<MemoMeta, 'title' | 'date' | 'created'>) {
  const ka = (a.date ?? a.created ?? '').slice(0, 10)
  const kb = (b.date ?? b.created ?? '').slice(0, 10)
  return kb.localeCompare(ka) || (b.created ?? '').localeCompare(a.created ?? '') || a.title.localeCompare(b.title, 'ko')
}
