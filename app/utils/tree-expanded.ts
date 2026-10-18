/**
 * 사이드바 트리에서 펼친 폴더를 이 기기에 기억한다 (설계문서 §7.4, 2026-10-18 사용자 요청).
 * 폴더가 깊어 처음에 전부 펼치면 목록이 길어졌다 — 기억한 게 없으면 전부 접힌 채로 시작한다.
 *
 * localStorage 는 막혀 있을 수 있다(사생활 보호 창 등) — 실패해도 조용히 넘어간다. 기억 못 하면 접힌 채로 시작할 뿐이다.
 */
const KEY = 'memo-tree-expanded'

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 기억한 펼침 키(`folder:<경로>`) — 없거나 깨졌으면 null */
export function readExpanded(store = storage()): string[] | null {
  try {
    const raw = store?.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((k) => typeof k === 'string') ? parsed : null
  } catch {
    return null
  }
}

export function writeExpanded(keys: string[], store = storage()) {
  try {
    store?.setItem(KEY, JSON.stringify(keys))
  } catch {
    // 기억하지 못하면 다음에 접힌 채로 시작한다
  }
}
