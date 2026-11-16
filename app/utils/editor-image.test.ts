import { describe, expect, it } from 'vitest'
import { imageHeightForWidth, memoImageDimension, memoImageMarkdown } from './editor-image'

describe('이미지 크기와 저장 HTML', () => {
  it.each([1, 320, 10000, '320', ' 640 '])('유효한 크기 %s를 정수로 읽는다', value => {
    expect(memoImageDimension(value)).toBe(Number(value))
  })

  it.each([0, -1, 1.5, Infinity, NaN, 10001, null, undefined, '', '12px', '1e3', '2" onerror="alert(1)'])('잘못된 크기 %s를 거부한다', value => {
    expect(memoImageDimension(value)).toBeNull()
  })

  it('크기 없는 일반 이미지는 기존 Markdown 렌더러에 맡긴다', () => {
    expect(memoImageMarkdown({ type: 'image', attrs: { src: 'assets/photo.png', alt: '숲', title: '가을 풍경' } })).toBeUndefined()
  })

  it('크기와 상대 원본 경로를 안전한 HTML 속성으로 보존한다', () => {
    expect(memoImageMarkdown({ type: 'image', attrs: { src: 'assets/photo.png', alt: '숲', title: '가을 풍경', width: 320, height: 240 } }))
      .toBe('<img src="assets/photo.png" alt="숲" title="가을 풍경" width="320" height="240">')
  })

  it('설명과 제목의 따옴표·대괄호가 Markdown 구조나 HTML 속성을 깨뜨리지 않는다', () => {
    expect(memoImageMarkdown({ type: 'image', attrs: { src: 'assets/a b.png', alt: '이름] <tag>', title: '" onclick="x & y\n다음 줄' } }))
      .toBe('<img src="assets/a b.png" alt="이름] &lt;tag&gt;" title="&quot; onclick=&quot;x &amp; y&#10;다음 줄">')
  })

  it('잘못된 크기를 HTML 속성에 넣지 않는다', () => {
    expect(memoImageMarkdown({ type: 'image', attrs: { src: 'assets/photo.png', width: '320" onerror="x', height: 120 } }))
      .toBe('<img src="assets/photo.png" alt="" height="120">')
  })

  it('가로 크기 변경에서 원본 비율을 유지하고 알 수 없는 비율은 추측하지 않는다', () => {
    expect(imageHeightForWidth(320, 1600, 1200)).toBe(240)
    expect(imageHeightForWidth(100, 3, 2)).toBe(67)
    expect(imageHeightForWidth(320, null, null)).toBeNull()
    expect(imageHeightForWidth(10000, 1, 10000)).toBeNull()
  })
})
