/** 내 템플릿 목록에는 메모 본문·이미지 경로를 싣지 않는다. */
export interface MemoTemplateSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface MemoTemplate extends MemoTemplateSummary {
  title: string
  content: string
  tags: string[]
}
