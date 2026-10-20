import type { MemoMeta } from './memo'

/** 인증된 활성 메모의 메타만 반환한다. 원문/비공개 인덱스는 공개 화면에 전달하지 않는다. */
export type BacklinksResponse = MemoMeta[]
