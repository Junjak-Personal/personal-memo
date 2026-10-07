import { describe, expect, it } from 'vitest'
import { isInboxItem, memoFromShare } from './share-inbox'

const item = (text: string, url: string | null = null) => ({ id: 'X', text, url, receivedAt: '2026-10-07T03:00:00Z' })

describe('memoFromShare', () => {
  it('사파리 공유 — 페이지 제목이 제목, 본문은 그 제목의 링크', () => {
    expect(memoFromShare(item('읽을 기사 제목', 'https://example.com/a?b=1'))).toEqual({
      title: '읽을 기사 제목',
      content: '[읽을 기사 제목](https://example.com/a?b=1)',
      date: null,
      dateEnd: null,
      tags: [],
    })
  })

  it('글만 공유 — 첫 줄이 제목, 나머지가 본문', () => {
    expect(memoFromShare(item('장보기\n우유\n달걀'))).toMatchObject({ title: '장보기', content: '우유\n달걀' })
  })

  it('글 없이 링크만 — 호스트가 제목, 링크 글자는 주소', () => {
    expect(memoFromShare(item('', 'https://news.example.com/x'))).toMatchObject({
      title: 'news.example.com',
      content: '[https://news.example.com/x](https://news.example.com/x)',
    })
  })

  it('링크 글자의 대괄호와 주소의 괄호·공백을 막는다', () => {
    const memo = memoFromShare(item('[속보] 제목', 'https://ko.wikipedia.org/wiki/A_(B) c'))
    expect(memo.content).toBe('[\\[속보\\] 제목](https://ko.wikipedia.org/wiki/A_%28B%29%20c)')
  })

  it('http(s) 가 아닌 주소는 링크로 만들지 않는다', () => {
    expect(memoFromShare(item('제목', 'javascript:alert(1)')).content).toBe('javascript:alert(1)')
  })

  it('아무것도 없으면 「공유한 메모」', () => {
    expect(memoFromShare(item('   '))).toMatchObject({ title: '공유한 메모', content: '' })
  })

  it('제목은 80자까지', () => {
    expect(memoFromShare(item('가'.repeat(200))).title).toHaveLength(80)
  })
})

describe('isInboxItem', () => {
  it('모양이 맞는 것만', () => {
    expect(isInboxItem(item('a', 'u'))).toBe(true)
    expect(isInboxItem({ id: 'X', text: 'a', receivedAt: 'r' })).toBe(true)
    expect(isInboxItem({ id: 1, text: 'a', receivedAt: 'r' })).toBe(false)
    expect(isInboxItem(null)).toBe(false)
  })
})
