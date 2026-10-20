import { describe, expect, it } from 'vitest'
import { imageSize, sniffImage } from './images'

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat())

function png(width: number, height: number) {
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), ascii('IHDR'), be32(width), be32(height), [8, 6, 0, 0, 0])
}

function webp(chunk: string, payload: number[]) {
  return bytes(ascii('RIFF'), be32(0), ascii('WEBP'), ascii(chunk), le24(payload.length), [0], payload, new Array(8).fill(0))
}

/** SOI → APP0(JFIF) → (끼워 넣을 것) → SOFn → SOS */
function jpeg(width: number, height: number, { sof = 0xc0, before = [] as number[] } = {}) {
  const app0 = [0xff, 0xe0, ...be16(16), ...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const frame = [0xff, sof, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
  return bytes([0xff, 0xd8], app0, before, frame, [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])
}

describe('imageSize — 파일 앞부분에서 가로·세로', () => {
  it('PNG·GIF', () => {
    expect(imageSize(png(2313, 1779), 'png')).toEqual({ width: 2313, height: 1779 })
    expect(imageSize(bytes(ascii('GIF89a'), le16(640), le16(480), [0, 0, 0]), 'gif')).toEqual({ width: 640, height: 480 })
  })

  it('WebP — 손실(VP8)·무손실(VP8L)·확장(VP8X)', () => {
    // VP8: 프레임 태그 3 + 시작 코드 9d 01 2a + 14비트 가로·세로 (위 2비트는 배율)
    const lossy = webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(2048 | 0x4000), ...le16(1536)])
    expect(sniffImage(lossy)).toBe('webp')
    expect(imageSize(lossy, 'webp')).toEqual({ width: 2048, height: 1536 })
    // VP8L: 0x2f 다음 32비트에 (가로-1) 14비트, (세로-1) 14비트
    const bits = (3000 - 1) | ((1200 - 1) << 14)
    expect(imageSize(webp('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >>> 24) & 0xff]), 'webp')).toEqual({ width: 3000, height: 1200 })
    // VP8X: 플래그 1 + 예약 3 다음 (가로-1)·(세로-1) 24비트
    expect(imageSize(webp('VP8X', [0, 0, 0, 0, ...le24(4999), ...le24(99)]), 'webp')).toEqual({ width: 5000, height: 100 })
  })

  it('JPEG — 기본·점진(SOF2), 앞에 다른 표지·채움 바이트가 있어도', () => {
    expect(imageSize(jpeg(4032, 3024), 'jpg')).toEqual({ width: 4032, height: 3024 })
    expect(imageSize(jpeg(800, 600, { sof: 0xc2 }), 'jpg')).toEqual({ width: 800, height: 600 })
    // DHT(C4)는 SOF 가 아니다 — 건너뛰고 뒤의 SOF 를 읽는다
    const dht = [0xff, 0xc4, ...be16(5), 0, 0, 0]
    expect(imageSize(jpeg(1024, 768, { before: [...dht, 0xff] }), 'jpg')).toEqual({ width: 1024, height: 768 })
  })

  it('못 읽으면 null — 잘린 파일, SOF 없이 데이터 시작', () => {
    expect(imageSize(png(10, 10).subarray(0, 20), 'png')).toBeNull()
    expect(imageSize(png(0, 10), 'png')).toBeNull()
    expect(imageSize(bytes([0xff, 0xd8], [0xff, 0xda, 0, 2], new Array(20).fill(0)), 'jpg')).toBeNull()
    expect(imageSize(jpeg(10, 10).subarray(0, 24), 'jpg')).toBeNull()
  })
})

// 표 안의 이미지도 일반 메모 이미지와 같은 공개 허용 목록·정리 규칙을 따른다.
describe('실제 이미지 참조', () => {
  it('Markdown과 HTML 이미지를 세고 코드·주석·외부 이미지·숨김 경로는 제외한다', async () => {
    const { referencedImages } = await import('./images')
    const body = '![사진](assets/a.png)\n<table><tr><td><img alt="표 > 이미지" src="assets/b.jpg"></td></tr></table>\n<img src="/api/files/다른/assets/c.webp">\n`![예](assets/code.png)`\n```html\n<img src="assets/fenced.png">\n```\n<pre><img src="assets/pre.png"></pre>\n<!-- <img src="assets/comment.png"> -->\n<img src="https://example.test/assets/x.png">\n<img src="../.templates/assets/private.png">'
    expect([...referencedImages('현재', body)]).toEqual(['현재/assets/a.png', '현재/assets/b.jpg', '다른/assets/c.webp'])
  })
  it('중첩 백틱과 가짜 data-src는 제외하고 모호한 들여쓴 참조는 보존한다', async () => {
    const { referencedImages } = await import('./images')
    expect([...referencedImages('', '`` `![예](assets/a.png)` ``\n\n    ![예](assets/b.png)\n<img data-src="assets/c.png">\n![진짜](<assets/d.png> "제목")')]).toEqual(['assets/b.png', 'assets/d.png'])
  })
})


it('HTML 속성 안에 적힌 가짜 이미지나 Markdown은 공개 허용 목록에 넣지 않는다', async () => {
  const { referencedImages } = await import('./images')
  expect([...referencedImages('', `<div title='<img src="assets/private.png"> ![비밀](assets/secret.png)'>예시</div><img src="assets/real.png">`)]).toEqual(['assets/real.png'])
})


it('img의 다른 속성 값 안에 적힌 src를 이미지 허용 목록으로 오인하지 않는다', async () => {
  const { referencedImages } = await import('./images')
  expect([...referencedImages('', `<img alt='fake src="assets/private.png"' src="assets/real.png">`)]).toEqual(['assets/real.png'])
})


it('들여쓴 목록·HTML 표 이미지를 보존하고 HTML 엔티티를 실제 파일 경로로 해석한다', async () => {
  const { referencedImages } = await import('./images')
  const body = '- 목록\n\n    ![사진](assets/nested.png)\n<table>\n    <tr><td><img src="assets/table.png"></td></tr>\n</table>\n<img src="/api/files/A&amp;B/assets/entity.png">'
  expect([...referencedImages('', body)]).toEqual(['assets/nested.png', 'assets/table.png', 'A&B/assets/entity.png'])
})


it('속성 값 속 주석·code·백틱을 실제 문법으로 오인하지 않는다', async () => {
  const { referencedImages } = await import('./images')
  const body = '<img alt="<!--" src="assets/comment.png"><img alt="<code>" src="assets/code.png"><img alt="`" src="assets/tick.png"> `예시` <img src="assets/last.png">'
  expect([...referencedImages('', body)]).toEqual(['assets/comment.png', 'assets/code.png', 'assets/tick.png', 'assets/last.png'])
  expect([...referencedImages('', '<pre><img src="assets/hidden.png">')]).toEqual([])
})


it('화면 주소의 인코딩된 폴더와 HTML 엔티티를 같은 실제 경로로 정규화한다', async () => {
  const { referencedImages } = await import('./images')
  expect([...referencedImages('', '<img src="/api/files/A%26B/assets/x.png"><img src="/api/files/A&amp;B/assets/x.png">')]).toEqual(['A&B/assets/x.png'])
})


it('유효한 줄 시작 inline backtick을 fence로 오판해 뒤의 실제 이미지를 놓치지 않는다', async () => {
  const { referencedImages } = await import('./images')
  expect([...referencedImages('', '```inline```\n\n![실제](assets/real.png)')]).toEqual(['assets/real.png'])
})


it('HTML 표의 multiline 속성·셀 fence는 Markdown code가 아니며 GC 열거와 공개 경계를 구분한다', async () => {
  const { referencedImages } = await import('./images')
  const table = '<table>\n<tr><td><img alt="예시\n```\n설명" src="assets/quoted.png"></td></tr>\n<tr><td>\n```\n<img src="assets/cell.png">\n</td></tr></table>'
  expect([...referencedImages('', table)]).toEqual(['assets/quoted.png', 'assets/cell.png'])
  const code = '```html\n<img src="assets/code.png">\n```'
  expect([...referencedImages('', code)]).toEqual([])
  expect([...referencedImages('', code, true)]).toEqual(['assets/code.png'])
})
