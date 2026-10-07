/**
 * 신뢰 경계 — 요청 본문은 화면이 만들지만 통째로 믿지 않는다. 여기서 좁히고 안쪽으로는 좁힌 타입만 보낸다.
 */
import type { CreateMemoInput, MemoInput, UpdateMemoInput } from '../../shared/types/memo'
import { isDateString } from '../../shared/utils/memo-date'
import { MemoError } from './errors'

const MAX_TITLE = 200
const MAX_CONTENT = 2_000_000

type Body = Record<string, unknown>

function bad(message: string): never {
  throw new MemoError('bad_request', message)
}

function asBody(raw: unknown): Body {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad('요청 본문이 객체가 아닙니다')
  return raw as Body
}

export function str(body: Body, key: string, max: number) {
  const v = body[key]
  if (typeof v !== 'string') bad(`${key}: 문자열이어야 합니다`)
  if (v.length > max) bad(`${key}: ${max}자를 넘습니다`)
  return v
}

function dateOrNull(body: Body, key: string) {
  const v = body[key]
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' || !isDateString(v)) bad(`${key}: YYYY-MM-DD 형식의 날짜여야 합니다`)
  return v
}

function memoInput(body: Body): MemoInput {
  const title = str(body, 'title', MAX_TITLE).trim()
  const content = str(body, 'content', MAX_CONTENT)
  const date = dateOrNull(body, 'date')
  let dateEnd = dateOrNull(body, 'dateEnd')
  if (dateEnd && !date) bad('끝 날짜만 있고 시작 날짜가 없습니다')
  if (date && dateEnd && dateEnd < date) bad('끝 날짜가 시작 날짜보다 앞섭니다')
  // 하루짜리는 끝 날짜를 두지 않는다 — 같은 뜻을 두 가지로 적지 않기 위해
  if (dateEnd === date) dateEnd = null
  return { title, content, date, dateEnd }
}

export function parseCreateInput(raw: unknown): CreateMemoInput {
  const body = asBody(raw)
  const folder = body.folder ?? ''
  if (typeof folder !== 'string') bad('folder: 문자열이어야 합니다')
  return { ...memoInput(body), folder }
}

export function parseUpdateInput(raw: unknown): UpdateMemoInput {
  const body = asBody(raw)
  return { ...memoInput(body), baseVersion: str(body, 'baseVersion', 64) }
}

/** `{ folder }`, `{ parent, name }` 처럼 문자열 필드 몇 개짜리 본문 */
export function parseStrings<K extends string>(raw: unknown, keys: readonly K[]): Record<K, string> {
  const body = asBody(raw)
  const out = {} as Record<K, string>
  for (const key of keys) out[key] = str(body, key, 1000)
  return out
}
