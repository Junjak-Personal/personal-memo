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
