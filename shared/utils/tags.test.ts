import { describe, expect, it } from 'vitest'
import { cleanTags, hasTag, parseSearchQuery, sameTags, TAG_DELIMITER } from './tags'

describe('tags', () => {
  it('cleanTags 는 앞쪽 #·공백을 떼고 중복을 뺀다', () => {
    expect(cleanTags([' #업무', '회의', '업무', '##', '  '])).toEqual(['업무', '회의'])
  })

  it('한글 조합형(NFD)도 같은 태그로 본다', () => {
    expect(cleanTags(['회의'.normalize('NFD'), '회의'])).toEqual(['회의'])
  })

  it('sameTags 는 순서까지 본다', () => {
    expect(sameTags(['a', 'b'], ['a', 'b'])).toBe(true)
    expect(sameTags(['a', 'b'], ['b', 'a'])).toBe(false)
  })

  it('hasTag 는 영문 대소문자를 가리지 않는다', () => {
    expect(hasTag(['Work'], 'work')).toBe(true)
  })

  it('검색어에서 #태그 와 글자를 나눈다', () => {
    expect(parseSearchQuery('  #업무 회의  메모 #Plan ')).toEqual({ tags: ['업무', 'Plan'], text: '회의 메모' })
    expect(parseSearchQuery('#')).toEqual({ tags: [], text: '#' })
  })

  it('입력칸은 공백·쉼표에서 끊는다', () => {
    expect(TAG_DELIMITER.test(' ')).toBe(true)
    expect(TAG_DELIMITER.test(',')).toBe(true)
    expect(TAG_DELIMITER.test('a')).toBe(false)
  })
})
