import { describe, expect, it } from 'vitest'
import { diffMemoLines } from './revision-diff'

describe('수정 이력 줄 단위 비교', () => {
  it('같은 본문은 차이가 없다고 표시한다', () => {
    expect(diffMemoLines('같은 내용', '같은 내용')).toEqual({ lines: [], added: 0, removed: 0, coarse: false, truncated: false })
  })
  it('중간 삽입·삭제와 그대로인 줄을 구분한다', () => {
    expect(diffMemoLines('제목\n옛 내용\n유지\n삭제', '제목\n새 내용\n유지\n추가')).toEqual({
      lines: [{ kind: 'equal', text: '제목' }, { kind: 'removed', text: '옛 내용' }, { kind: 'added', text: '새 내용' }, { kind: 'equal', text: '유지' }, { kind: 'removed', text: '삭제' }, { kind: 'added', text: '추가' }],
      added: 2, removed: 2, coarse: false, truncated: false,
    })
  })
  it('본문 전체 생성·삭제, 빈 줄과 마지막 줄바꿈을 보존한다', () => {
    expect(diffMemoLines('', '하나\n\n')).toMatchObject({ added: 3, removed: 0 })
    expect(diffMemoLines('하나\n\n', '')).toMatchObject({ added: 0, removed: 3 })
    expect(diffMemoLines('하나', '하나\n')).toMatchObject({ added: 1, removed: 0 })
  })
  it('공통 구간을 축약하고 변경 전후 문맥을 유지한다', () => {
    const prefix = Array.from({ length: 20 }, (_, index) => `같음 ${index}`)
    const result = diffMemoLines([...prefix, '이전', ...prefix].join('\n'), [...prefix, '현재', ...prefix].join('\n'))
    expect(result.lines[0]).toEqual({ kind: 'context', count: 17 })
    expect(result.lines.at(-1)).toEqual({ kind: 'context', count: 17 })
    expect(result).toMatchObject({ added: 1, removed: 1, truncated: false })
  })
  it('큰 변경 구간은 메모리를 제한하고 전체 추가·삭제 줄 수는 유지한다', () => {
    const before = Array.from({ length: 1000 }, (_, index) => `이전 ${index}`).join('\n')
    const after = Array.from({ length: 1000 }, (_, index) => `현재 ${index}`).join('\n')
    const result = diffMemoLines(before, after)
    expect(result).toMatchObject({ added: 1000, removed: 1000, coarse: true, truncated: true })
    expect(result.lines).toHaveLength(600)
  })
})
