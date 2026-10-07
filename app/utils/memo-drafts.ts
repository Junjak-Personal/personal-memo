/**
 * 저장하지 못한 수정을 이 기기에 보관한다 (설계문서 §7.2 — 오프라인 보호, 2026-10-07).
 *
 * 저장 요청을 보내기 «전에» 적고, 서버가 받으면 지운다. 그래서 연결이 끊기거나 앱이 꺼져도 마지막으로 보내려던
 * 내용이 남는다. 다시 연결되면 보관함이 대신 저장하고(plugins/memo-drafts.client.ts), 그 메모를 열면 화면이 되살린다.
 *
 * localStorage 는 막혀 있을 수 있다(사생활 보호 창 등) — 읽기·쓰기는 전부 실패해도 조용히 넘어가고 false 를 돌려준다.
 * 이 보관은 «덤»이다. 저장의 원본은 언제나 서버다.
 */
import type { MemoInput } from '#shared/types/memo'
import { apiStatus } from './api-error'

const PREFIX = 'memo-draft:'

export interface MemoDraft {
  id: string
  /** 이 수정이 기준으로 삼은 서버 버전. 서버가 그 뒤에 바뀌었으면 자동으로 덮지 않는다 */
  baseVersion: string
  input: Required<MemoInput>
  /** 보관한 시각 (ISO) */
  savedAt: string
  /** 서버가 409 로 거절했다 — 사람이 고를 때까지 자동 저장하지 않는다 */
  conflict?: boolean
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isDraft(value: unknown): value is MemoDraft {
  if (typeof value !== 'object' || value === null) return false
  const d = value as Record<string, unknown>
  const input = d.input as Record<string, unknown> | undefined
  return (
    typeof d.id === 'string' &&
    typeof d.baseVersion === 'string' &&
    typeof d.savedAt === 'string' &&
    typeof input === 'object' &&
    input !== null &&
    typeof input.title === 'string' &&
    typeof input.content === 'string' &&
    Array.isArray(input.tags)
  )
}

export function readDraft(id: string, store = storage()): MemoDraft | null {
  try {
    const raw = store?.getItem(PREFIX + id)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isDraft(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeDraft(draft: MemoDraft, store = storage()) {
  try {
    if (!store) return false
    store.setItem(PREFIX + draft.id, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function removeDraft(id: string, store = storage()) {
  try {
    store?.removeItem(PREFIX + id)
  } catch {
    // 지우지 못하면 다음 저장이 덮어쓴다
  }
}

export function listDrafts(store = storage()): MemoDraft[] {
  if (!store) return []
  const out: MemoDraft[] = []
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (!key?.startsWith(PREFIX)) continue
      const draft = readDraft(key.slice(PREFIX.length), store)
      if (draft) out.push(draft)
    }
  } catch {
    return out
  }
  return out
}

/** 응답이 없었다 — 서버가 거절한 게 아니라 닿지 못했다 */
export function isNetworkError(error: unknown) {
  return apiStatus(error) === null || (typeof navigator !== 'undefined' && navigator.onLine === false)
}
