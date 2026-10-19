import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { blockHandleOffset, blockHandleUi } from './drag-handle-options'

// 설치된 Tiptap의 실제 mouseleave 분기를 사용한다. 간격을 건널 때 숨기는 조건이 바뀌면 함께 재검토한다.
const uiRequire = createRequire(import.meta.resolve('@nuxt/ui'))
const pluginSource = readFileSync(uiRequire.resolve('@tiptap/extension-drag-handle').replace('/dist/index.cjs', '/src/drag-handle-plugin.ts'), 'utf8')
const leaveBody = pluginSource.match(/mouseleave\(_view, e\) \{([\s\S]*?)\n          \},/)?.[1]
if (!leaveBody) throw new Error('설치된 drag handle의 mouseleave 구현을 찾지 못했습니다')

function mouseLeave(insideHandle: boolean, locked = false) {
  const hide = vi.fn()
  const handler = runInNewContext(`(function (_view, e) { ${leaveBody!.replace(/ as HTMLElement/g, '')} })`, {
    locked,
    wrapper: { contains: () => insideHandle },
    hideHandle: hide,
    currentNode: {},
    currentNodePos: 0,
    editor: {},
    onNodeChange: undefined,
  }) as (view: object, event: { target: object; relatedTarget: object }) => void
  handler({}, { target: {}, relatedTarget: {} })
  return hide
}

describe('본문에서 블록 핸들까지 이어지는 마우스 영역', () => {
  it.each(['left', 'right'] as const)('%s 배치: 빈틈을 천천히 지나도 핸들을 숨기지 않는다', (side) => {
    const offset = blockHandleOffset({ rects: { reference: { height: 24 }, floating: { height: 28 } } }).mainAxis
    // Tailwind px 토큰의 기본 간격은 4px. 핸들의 가로 padding까지 실제 hit area에 포함한다.
    const padding = Number(blockHandleUi.root.match(/\bpx-(\d+)\b/)?.[1] ?? 0) * 4
    const buttons = 48
    const rootWidth = buttons + padding * 2
    const editorEdge = side === 'left' ? 200 : 700
    const rootEdge = editorEdge + (side === 'left' ? -offset : offset)
    const left = side === 'left' ? rootEdge - rootWidth : rootEdge
    const right = left + rootWidth
    const buttonEdge = side === 'left' ? right - padding : left + padding

    // 본문 경계부터 가장 가까운 버튼까지 0.5px씩 이동한다. 타이머로 빠르게 통과해야만 되는 해결은 배제한다.
    const distance = Math.abs(editorEdge - buttonEdge)
    for (let step = 0.5; step <= distance; step += 0.5) {
      const x = editorEdge + (side === 'left' ? -step : step)
      expect(mouseLeave(x >= left && x <= right), `${side}: 경계에서 ${step}px`).not.toHaveBeenCalled()
    }
    // 기본 8px 시각적 간격은 그대로 유지한다.
    expect(distance).toBe(8)
  })

  it('핸들과 관계없는 영역으로 벗어나면 기존처럼 숨긴다', () => {
    expect(mouseLeave(false)).toHaveBeenCalledOnce()
  })

  it('블록 메뉴가 열려 잠긴 동안에는 기존처럼 유지한다', () => {
    expect(mouseLeave(false, true)).not.toHaveBeenCalled()
  })

  it.each([[24, -2], [40, 6], [100, 0]])('높이 %ipx 블록의 기존 세로 정렬을 유지한다', (height, alignment) => {
    expect(blockHandleOffset({ rects: { reference: { height: height! }, floating: { height: 28 } } }).alignmentAxis).toBe(alignment)
  })
})
