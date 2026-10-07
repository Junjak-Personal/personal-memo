import { describe, expect, it } from 'vitest'
import { toDisplaySrc, toStoredSrc } from './asset-path'

describe('이미지 경로', () => {
  it('상대경로를 화면 주소로 바꾸고 되돌린다', () => {
    const shown = toDisplaySrc('업무/회의', 'assets/01JB.jpg')
    expect(shown).toBe('/api/files/%EC%97%85%EB%AC%B4/%ED%9A%8C%EC%9D%98/assets/01JB.jpg')
    expect(toStoredSrc('업무/회의', shown)).toBe('assets/01JB.jpg')
  })

  it('최상위 폴더도 다룬다', () => {
    expect(toStoredSrc('', toDisplaySrc('', 'assets/a.png'))).toBe('assets/a.png')
  })

  it('외부 주소·data URI 는 건드리지 않는다', () => {
    expect(toDisplaySrc('a', 'https://x.com/a.png')).toBe('https://x.com/a.png')
    expect(toDisplaySrc('a', 'data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
  })

  it('루트 위로 올라가는 경로는 그대로 둔다', () => {
    expect(toDisplaySrc('', '../밖.png')).toBe('../밖.png')
  })

  it('다른 폴더의 이미지는 상대경로로 되돌리지 않는다 — 다시 올려야 한다', () => {
    const other = toDisplaySrc('개인', 'assets/x.jpg')
    expect(toStoredSrc('업무', other)).toBe(other)
  })

  it('하위 폴더의 이미지는 같은 폴더로 보지 않는다 — 최상위 메모에 붙여도 화면 주소로 남겨 다시 올린다', () => {
    const child = toDisplaySrc('하위', 'assets/a.png')
    expect(toStoredSrc('', child)).toBe(child)
    const grandchild = toDisplaySrc('업무/회의', 'assets/a.png')
    expect(toStoredSrc('업무', grandchild)).toBe(grandchild)
  })
})
