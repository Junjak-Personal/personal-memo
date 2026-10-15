import { describe, expect, it } from 'vitest'
import { isRichHtml, looksLikeMarkdown } from './markdown-paste'

describe('looksLikeMarkdown — 붙여 넣은 글이 마크다운 문법을 쓰는가', () => {
  it('블록 문법', () => {
    expect(looksLikeMarkdown('## 회의록\n내용')).toBe(true)
    expect(looksLikeMarkdown('- 우유\n- 빵')).toBe(true)
    expect(looksLikeMarkdown('1. 첫째\n2. 둘째')).toBe(true)
    expect(looksLikeMarkdown('- [ ] 할 일\n- [x] 끝남')).toBe(true)
    expect(looksLikeMarkdown('> 인용한 글')).toBe(true)
    expect(looksLikeMarkdown('```ts\nconst a = 1\n```')).toBe(true)
    expect(looksLikeMarkdown('| 이름 | 값 |\n| --- | --- |\n| a | 1 |')).toBe(true)
  })

  it('인라인 문법', () => {
    expect(looksLikeMarkdown('이건 **중요**합니다')).toBe(true)
    expect(looksLikeMarkdown('[문서](https://example.com) 참고')).toBe(true)
    expect(looksLikeMarkdown('`pnpm dev` 로 띄운다')).toBe(true)
    expect(looksLikeMarkdown('~~취소~~')).toBe(true)
  })

  it('보통 글은 아니다 — 기본 붙여넣기에 맡긴다', () => {
    expect(looksLikeMarkdown('그냥 한 줄')).toBe(false)
    expect(looksLikeMarkdown('첫 줄\n둘째 줄\n\n셋째 문단')).toBe(false)
    expect(looksLikeMarkdown('C++ 와 C# 비교')).toBe(false)
    expect(looksLikeMarkdown('#해시태그 처럼 붙은 것')).toBe(false)
    expect(looksLikeMarkdown('3*4=12, a*b')).toBe(false)
    expect(looksLikeMarkdown('https://example.com/path_with_underscores')).toBe(false)
    expect(looksLikeMarkdown('')).toBe(false)
  })
})

describe('isRichHtml — 클립보드 HTML 이 이미 서식 있는 문서인가', () => {
  it('웹 페이지·문서 앱의 HTML 은 서식이 있다', () => {
    expect(isRichHtml('<h2>제목</h2><ul><li>하나</li></ul>')).toBe(true)
    expect(isRichHtml('<p>이건 <strong>중요</strong></p>')).toBe(true)
    expect(isRichHtml('<a href="https://x">링크</a>')).toBe(true)
  })

  it('이 앱에서 복사한 것(ProseMirror 조각)은 서식 있는 것으로 본다', () => {
    expect(isRichHtml('<p data-pm-slice="1 1 []">## 글자</p>')).toBe(true)
  })

  it('글자에 색만 입힌 HTML(VS Code 등)과 빈 값은 아니다', () => {
    expect(isRichHtml('<meta charset="utf-8"><div style="color: #ccc;"><div><span style="color: #569cd6;">## 제목</span></div><br></div>')).toBe(false)
    expect(isRichHtml('')).toBe(false)
  })
})
