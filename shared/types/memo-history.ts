import type { MemoInput } from './memo'

/** 본문은 상세 요청 때만 보낸다. 이력은 인증된 메모 화면에서만 읽는다. */
export interface MemoRevisionSummary {
  id: string
  savedAt: string
  title: string
  contentLength: number
}

export interface MemoRevision extends MemoRevisionSummary, MemoInput {
  tags: string[]
}
