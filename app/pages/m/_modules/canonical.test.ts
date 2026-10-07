import { describe, expect, it } from 'vitest'
import { canonicalMarkdown } from './useMemoAutosave'

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
