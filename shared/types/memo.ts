/**
 * 메모 API 의 모양. 서버와 화면이 이 한 벌만 쓴다.
 * 파일의 frontmatter 키는 snake_case(`date_end`)지만 API 는 camelCase 다 — 변환은 서버 저장소가 한다.
 */

/** 목록·검색·캘린더에 실리는 메타. 본문은 없다. */
export interface MemoMeta {
  /** ULID. `id` 가 없는 외부 생성 파일은 `p:<상대경로>` (설계문서 §3.2) */
  id: string
  /** `memos/` 기준 상대경로 — `업무/회의록.md` */
  path: string
  /** `memos/` 기준 폴더. 최상위는 빈 문자열 */
  folder: string
  title: string
  /** `2026-10-06T21:03:00+09:00`. 외부 생성 파일은 없을 수 있다 */
  created: string | null
  updated: string | null
  /** `YYYY-MM-DD` */
  date: string | null
  /** `YYYY-MM-DD`, 끝 날짜 포함 */
  dateEnd: string | null
  /** frontmatter `tags`. 없으면 빈 배열 */
  tags: string[]
  /** frontmatter 를 읽지 못한 파일 — 앱에서 저장하지 않는다 */
  unreadable: boolean
}

export interface Memo extends MemoMeta {
  content: string
  /** 파일 내용 해시. 저장할 때 baseVersion 으로 돌려보낸다 */
  version: string
}

export interface MemoInput {
  title: string
  content: string
  date: string | null
  dateEnd: string | null
  /** 새 메모: 없으면 태그 없음. 수정: 없으면 파일의 태그를 그대로 둔다 (옛 화면이 보낸 저장이 태그를 지우지 않게) */
  tags?: string[]
}

export interface CreateMemoInput extends MemoInput {
  folder: string
}

export interface UpdateMemoInput extends MemoInput {
  baseVersion: string
}

export interface FolderNode {
  path: string
  name: string
  children: FolderNode[]
}

export interface TreeResponse {
  folders: FolderNode[]
  memos: MemoMeta[]
}

export interface TrashItem {
  /** `.trash` 기준 상대경로 = 원래 위치 */
  path: string
  title: string
  /** 휴지통으로 옮긴 시각 (파일 mtime) */
  trashedAt: string
}

export interface SearchHit extends MemoMeta {
  /** 일치한 부분 앞뒤 발췌 */
  snippet: string
}

export interface CalendarResponse {
  /** created 가 기간 안인 메모 */
  created: MemoMeta[]
  /** date ~ date_end 가 기간과 겹치는 메모 */
  scheduled: MemoMeta[]
}

/** 409 응답의 data — 화면이 「다른 곳에서 수정됨」 안내에 쓴다 */
export interface ConflictData {
  code: 'conflict'
  version: string
}
