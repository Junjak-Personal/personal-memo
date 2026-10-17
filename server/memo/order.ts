/**
 * 순서 파일 — 폴더마다 `.order.json` (설계문서 §3.6). 사용자의 메모 파일이 아니라 앱이 쓰는 파일이다.
 * `.` 으로 시작해 스캔·폴더 목록에서 빠진다. 폴더를 옮기거나 지우면 폴더와 함께 따라가거나 사라진다.
 *
 * 🔴 손으로 고쳐 깨진 파일은 «순서 없음» 으로 읽는다 — 목록이 안 보이는 것보다 기본 순서가 낫다.
 *    다음에 순서를 바꾸면 올바른 내용으로 덮는다.
 */
import type { FolderOrder } from '../../shared/types/memo'
import { MAX_ORDER_ITEMS } from '../../shared/utils/order'

export const ORDER_FILE = '.order.json'

export interface OrderFile extends FolderOrder {
  /** 최상위 파일에만 — 「할 일」 화면의 순서 */
  todos: string[]
}

export const EMPTY_ORDER_FILE: OrderFile = { folders: [], memos: [], todos: [] }

/** 문자열만, 중복 없이, 상한까지 */
export function cleanKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out = new Set<string>()
  for (const v of value) {
    if (typeof v === 'string' && v && v.length <= 1024) out.add(v)
    if (out.size >= MAX_ORDER_ITEMS) break
  }
  return [...out]
}

export function parseOrderFile(raw: string): OrderFile {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ...EMPTY_ORDER_FILE }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ...EMPTY_ORDER_FILE }
  const record = data as Record<string, unknown>
  return { folders: cleanKeys(record.folders), memos: cleanKeys(record.memos), todos: cleanKeys(record.todos) }
}

/** 빈 목록은 적지 않는다 — 하위 폴더 파일에 `todos: []` 같은 군더더기를 남기지 않게 */
export function serializeOrderFile(order: OrderFile) {
  const out: Partial<OrderFile> = {}
  if (order.folders.length) out.folders = order.folders
  if (order.memos.length) out.memos = order.memos
  if (order.todos.length) out.todos = order.todos
  return `${JSON.stringify(out, null, 2)}\n`
}
