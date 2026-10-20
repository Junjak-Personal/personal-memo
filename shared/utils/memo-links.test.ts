import { describe, expect, it } from 'vitest'
import { extractMemoLinkIds, memoLinkHref, memoLinkId } from './memo-links'

const A = '01M5D265Y7R61BQEFWDT6RA27E'
const B = '01M5D265Y7R61BQEFWDT6RA27F'
const link = (id = A) => `[메모](/m/${id})`

describe('내부 메모 주소', () => {
  it('정확한 영구 ID 주소만 허용하고 한 번의 인코딩을 푼다', () => {
    expect(memoLinkId(memoLinkHref(A))).toBe(A)
    expect(memoLinkId(`/m/%30${A.slice(1)}`)).toBe(A)
  })
  it.each([null, 12, '', `/m/${A}?x=1`, `/m/${A}#section`, `https://memo.example/m/${A}`, `//evil/m/${A}`, `/m/${A}/`, '/m/p%3Afile.md', '/m/../file', '/m/%ZZ', `/m/${A.toLowerCase()}`, ` /m/${A}`, `/m/${A}\n`])('잘못된 주소 %s는 내부 링크가 아니다', href => {
    expect(memoLinkId(href)).toBeNull()
  })
  it('경로 ID와 외부 주소로 저장 URL을 만들지 않는다', () => {
    expect(() => memoLinkHref('p:비밀.md')).toThrow()
    expect(() => memoLinkHref('https://evil')).toThrow()
  })
})

describe('백링크 원문 추출', () => {
  it('일반 문단·목록·중첩/escape된 제목·제목 인자·HTML 표의 실제 링크만 중복 없이 모은다', () => {
    const source = `${link()}\n- [표시 \\[괄호\\]](</m/${B}> "제목")\n${link()}\n<table><tr><td><a href="/m/${B}">메모</a></td></tr></table>`
    expect([...extractMemoLinkIds(source)]).toEqual([A, B])
  })
  it('인라인 코드·fenced code·들여쓴 코드·HTML 코드·주석은 제외한다', () => {
    const source = [
      '`' + link() + '`', '``x `' + link() + ' y``',
      '```md', link(), '```', '~~~', link(), '~~~~',
      '', '    ' + link(), '',
      `<code><a href="/m/${A}">코드</a></code>`,
      `<pre>${link()}</pre>`, `<!-- ${link()} -->`,
    ].join('\n')
    expect([...extractMemoLinkIds(source)]).toEqual([])
  })
  it('코드 앞의 emoji도 UTF16 인덱스를 유지하며 뒤의 진짜 링크만 읽는다', () => {
    expect([...extractMemoLinkIds('😀 `' + link() + '` 😎 ' + link(B))]).toEqual([B])
    expect([...extractMemoLinkIds(['😀', '', '```md', link(), '```', link(B)].join('\n'))]).toEqual([B])
  })
  it('이미지·escape된 Markdown·일반 URL·HTML 속성의 가짜 링크를 제외한다', () => {
    const source = `![사진](/m/${A})\n\\${link()}\n[외부](https://site/m/${A})\n<img alt="${link()}" src="x">`
    expect([...extractMemoLinkIds(source)]).toEqual([])
  })
  it('blockquote fence는 제외하되 실제 중첩 목록 링크를 유지한다', () => {
    const source = ['> ```', '> ' + link(), '> ```', '', '- 목록', '    ' + link(B)].join('\n')
    expect([...extractMemoLinkIds(source)]).toEqual([B])
  })
  it('정의되지 않은 대괄호가 많이 있어도 뒤의 정상 링크를 찾는다', () => {
    expect([...extractMemoLinkIds('['.repeat(20_000) + '\n' + link())]).toEqual([A])
  })
  it('이미지 alt의 여러 중첩 Markdown/HTML 링크를 실제 참조로 읽지 않는다', () => {
    const source = `![outer [one](/m/${A}) [two](/m/${B}) <a href="/m/${A}">alt</a>](image.png)`
    expect([...extractMemoLinkIds(source)]).toEqual([])
  })
  it('줄 앞의 triple inline code를 fence로 오해해 뒤의 실제 링크를 지우지 않는다', () => {
    expect([...extractMemoLinkIds('```' + link() + '``` ' + link(B))]).toEqual([B])
  })
})
