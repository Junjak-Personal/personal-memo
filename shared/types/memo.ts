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
  /**
   * 할 일 (frontmatter `done`, 2026-10-08). null = 할 일이 아닌 메모, false = 안 끝남, true = 끝남.
   * `done: true/false` 가 아닌 값(`done: yes` 등)은 null 로 읽고 파일의 값은 건드리지 않는다.
   * 할 일은 「할 일」 폴더 바로 아래에만 있다 (2026-10-22) — shared/utils/todo.ts 의 doneInFolder.
   */
  done: boolean | null
  /**
   * 할 일의 중요도 (frontmatter `priority`, 2026-10-22). 키가 없거나 모르는 값이면 'medium'. 'medium' 은 파일에 적지 않는다.
   * 할 일이 아닌 메모에서는 뜻이 없다 — 할 일을 풀면 키를 지운다.
   */
  priority: TodoPriority
  /** 외부 공개 (frontmatter `public: true`, 2026-10-16) — `/ext/{id}` 를 로그인 없이 읽기 전용으로 연다 */
  public: boolean
  /** 공개 폴더에서 상속한 상태. 개별 frontmatter 공개 여부와 구분한다. */
  publicInherited?: boolean
  publicDirect?: boolean
  /** 공개 화면에 쓰는 식별자. 경로 기반 내부 ID는 외부에 내보내지 않는다. */
  publicId?: string
  /** frontmatter 를 읽지 못한 파일 — 앱에서 저장하지 않는다 */
  unreadable: boolean
}

/** 할 일의 중요도 — 상·중·하 */
export type TodoPriority = 'high' | 'medium' | 'low'

/** 외부 공개 화면이 받는 것 — 제목·본문·수정 시각만. 폴더·태그·날짜는 내보내지 않는다 */
export interface PublicMemo {
  title: string
  content: string
  updated: string | null
}

export type PublicMemoSummary = Pick<MemoMeta, 'id' | 'title'>

/** 공개 탐색에 필요한 이름·공개 식별자만. 비공개 조상 경로·메타는 포함하지 않는다. */
export interface PublicFolderNode {
  id: string
  name: string
  children: PublicFolderNode[]
  memos: PublicMemoSummary[]
}

export interface PublicTreeResponse {
  folders: PublicFolderNode[]
  memos: PublicMemoSummary[]
}

export interface Memo extends MemoMeta {
  content: string
  /** 파일 내용 해시(`done`·`public` 줄은 빼고). 저장할 때 baseVersion 으로 돌려보낸다 */
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

/**
 * 할 일 체크(`done`)는 저장 입력에 없다 — 편집기가 들고 있는 내용이 아니라서다. 수정 저장은 파일의 값을 그대로 두고,
 * 바꾸는 길은 `PATCH /api/memos/:id/done` 하나다. 새로 만들 때만 할 일로 만들 수 있다.
 */
export interface CreateMemoInput extends MemoInput {
  folder: string
  /** false = 할 일로 만든다(「할 일」 폴더에 생긴다). 없으면 일반 메모 — 단 「할 일」 폴더에 만들면 할 일 */
  done?: boolean
  /** 할 일일 때만. 없으면 'medium' */
  priority?: TodoPriority
}

export interface UpdateMemoInput extends MemoInput {
  baseVersion: string
}

export interface FolderNode {
  path: string
  name: string
  children: FolderNode[]
  public?: boolean
  publicInherited?: boolean
  publicDirect?: boolean
  publicId?: string
}

/**
 * 한 폴더 안의 순서 — 그 폴더의 `.order.json` (설계문서 §3.6). 폴더는 이름, 메모는 id.
 * 여기에 없는 것은 맨 위(메모는 만든 시각 최근순, 폴더는 이름순) — shared/utils/order.ts
 */
export interface FolderOrder {
  folders: string[]
  memos: string[]
}

export interface TreeResponse {
  folders: FolderNode[]
  memos: MemoMeta[]
  /** 폴더 경로(최상위는 '') → 순서. 순서를 한 번도 바꾸지 않은 폴더는 없다 */
  orders: Record<string, FolderOrder>
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
