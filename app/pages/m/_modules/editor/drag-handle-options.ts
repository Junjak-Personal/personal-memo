import type { EditorDragHandleProps } from '@nuxt/ui'

interface HandleRects {
  rects: { reference: { height: number }; floating: { height: number } }
}

export function blockHandleOffset({ rects }: HandleRects) {
  return {
    alignmentAxis: rects.reference.height > 40 ? 0 : (rects.reference.height - rects.floating.height) / 2,
    // 바깥 offset에 빈틈이 있으면 editor mouseleave가 버튼 도착 전에 핸들을 숨긴다.
    mainAxis: 0,
  }
}

export const blockHandleOptions = { offset: blockHandleOffset } satisfies NonNullable<EditorDragHandleProps['options']>
// 8px 시각적 간격은 내부 padding으로 둔다. flip으로 오른쪽에 떠도 본문까지 hit area가 이어진다.
export const blockHandleUi = { root: 'px-2' }
