import { describe, expect, it } from 'vitest'
import { canonicalMarkdown, shouldSaveMarkdown } from './useMemoAutosave'

describe('형식 바뀜 검사의 정규화', () => {
  it('모양만 다른 차이는 같게 본다', () => {
    expect(canonicalMarkdown('S1~S6')).toBe(canonicalMarkdown('S1\\~S6'))
    expect(canonicalMarkdown('| a | b |\n| --- | --- |')).toBe(canonicalMarkdown('| a   | b           |\n| --- | ----------- |'))
    expect(canonicalMarkdown('a\n\n\n\nb  ')).toBe(canonicalMarkdown('a\n\nb'))
  })

  it('각주가 글자로 바뀐 것은 다르게 본다', () => {
    expect(canonicalMarkdown('각주[^1]')).not.toBe(canonicalMarkdown('각주\\[^1\\]'))
  })

  it('HTML 블록이 사라진 것은 다르게 본다', () => {
    expect(canonicalMarkdown('<div>HTML</div>')).not.toBe(canonicalMarkdown('HTML'))
  })
})

describe('블록 이동과 실행 취소의 자동 저장 판단', () => {
  it('최초 에디터 정규화는 기존 초기 기준과 같으면 저장하지 않는다', () => {
    expect(shouldSaveMarkdown('HTML\n\n', '<div>HTML</div>', 'HTML')).toBe(false)
  })

  it('블록 순서가 바뀌면 저장하고 저장된 이동을 원문으로 되돌려도 다시 저장한다', () => {
    const original = '첫 문단\n\n둘째 문단'
    const moved = '둘째 문단\n\n첫 문단'
    expect(shouldSaveMarkdown(moved, original, null)).toBe(true)
    expect(shouldSaveMarkdown(original, moved, null)).toBe(true)
  })

  it('현재 내용과 정규화 결과가 같으면 최초/후속 update 모두 중복 저장하지 않는다', () => {
    const current = '첫 문단\n\n둘째 문단'
    const equivalent = '첫 문단  \n\n\n둘째 문단\n'
    expect(shouldSaveMarkdown(equivalent, current, '다른 기준')).toBe(false)
    expect(shouldSaveMarkdown(equivalent, current, null)).toBe(false)
  })

  it('최초 update여도 초기 기준과 다른 실제 변경이면 저장한다', () => {
    expect(shouldSaveMarkdown('수정된 문단', '<div>원문</div>', '원문')).toBe(true)
  })
})
