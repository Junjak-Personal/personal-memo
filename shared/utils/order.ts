/**
 * 사이드바·할 일 화면의 순서 (2026-10-17 사용자 요청) — 끌어 놓은(폰은 메뉴로 옮긴) 순서를 폴더마다
 * `.order.json` 에 남긴다. 파일에는 순서가 없으므로 순서는 이 파일 하나가 정한다 (설계문서 §3.6).
 *
 * 순서에 없는 것 — 새로 만든 것, 다른 폴더에서 옮겨 온 것, 순서를 한 번도 안 바꾼 폴더 — 은 맨 위에 선다.
 * 메모·할 일은 만든 시각 최근순, 폴더는 이름순. 순서에 남은 지워진 이름·id 는 무시한다.
 */
import type { FolderOrder, MemoMeta } from '../types/memo'

export const EMPTY_ORDER: FolderOrder = { folders: [], memos: [] }

/** 한 목록에 남기는 최대 개수 — 요청 크기 상한 */
export const MAX_ORDER_ITEMS = 5000

/** 최근에 만든 것부터. 만든 시각이 없는 바깥 파일은 뒤로, 같으면 제목순 */
export function byCreatedDesc(a: Pick<MemoMeta, 'created' | 'title'>, b: Pick<MemoMeta, 'created' | 'title'>) {
  return (b.created ?? '').localeCompare(a.created ?? '') || a.title.localeCompare(b.title, 'ko')
}

export function byName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, 'ko')
}

/** 저장된 순서대로 세운다. 순서에 없는 것은 앞에, compareFresh 순으로 */
export function applyOrder<T>(items: readonly T[], order: readonly string[], keyOf: (item: T) => string, compareFresh: (a: T, b: T) => number): T[] {
  const rank = new Map(order.map((key, i) => [key, i]))
  const fresh = items.filter((item) => !rank.has(keyOf(item))).sort(compareFresh)
  const listed = items.filter((item) => rank.has(keyOf(item))).sort((a, b) => (rank.get(keyOf(a)) ?? 0) - (rank.get(keyOf(b)) ?? 0))
  return [...fresh, ...listed]
}

/** key 를 target 의 앞(before)이나 뒤(after)로 옮긴 새 목록. 둘 중 하나라도 없으면 그대로 */
export function moveKey(keys: readonly string[], key: string, target: string, place: 'before' | 'after'): string[] {
  if (key === target || !keys.includes(key) || !keys.includes(target)) return [...keys]
  const rest = keys.filter((k) => k !== key)
  const at = rest.indexOf(target) + (place === 'after' ? 1 : 0)
  return [...rest.slice(0, at), key, ...rest.slice(at)]
}

/** 한 칸 위(-1)·아래(+1)로. 끝에서는 그대로 */
export function stepKey(keys: readonly string[], key: string, delta: -1 | 1): string[] {
  const i = keys.indexOf(key)
  const neighbor = i === -1 ? undefined : keys[i + delta]
  if (neighbor === undefined) return [...keys]
  return moveKey(keys, key, neighbor, delta === -1 ? 'before' : 'after')
}
