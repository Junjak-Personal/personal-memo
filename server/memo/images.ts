/**
 * 이미지 판별과 본문 속 이미지 참조 (설계문서 §4).
 */
import { imageRefs } from './image-refs'
import { isRelativeSrc, normalizePath } from '../../shared/utils/asset-path'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** 원본 보관 (2026-10-07) — 아이폰 사진 원본이 넉넉히 들어가게 */
export const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024

export type ImageExt = 'jpg' | 'png' | 'gif' | 'webp'

export const IMAGE_TYPES: Record<ImageExt, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

/**
 * 앞부분 바이트로 형식을 정한다. 확장자·Content-Type 은 믿지 않는다.
 * SVG 는 받지 않는다 — 스크립트를 품을 수 있고 같은 출처에서 열리면 XSS 다.
 */
export function sniffImage(bytes: Uint8Array): ImageExt | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b)
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'gif'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  return null
}

/**
 * 파일 앞부분에서 가로·세로를 읽는다 — 서버에는 이미지 라이브러리가 없다(§4). 못 읽으면 null.
 * JPEG 의 EXIF 회전은 보지 않는다 — 가로·세로가 뒤바뀔 뿐 «둘 다 N 이하» 판정은 같다.
 */
export function imageSize(bytes: Uint8Array, ext: ImageExt): { width: number; height: number } | null {
  const at = (i: number) => bytes[i] ?? 0
  const u16be = (i: number) => (at(i) << 8) | at(i + 1)
  const u16le = (i: number) => at(i) | (at(i + 1) << 8)
  const u24le = (i: number) => at(i) | (at(i + 1) << 8) | (at(i + 2) << 16)
  const u32be = (i: number) => at(i) * 0x1000000 + ((at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3))
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null)

  switch (ext) {
    case 'png':
      // 시그니처 8 + IHDR 길이 4 + 이름 4 다음이 가로·세로
      return bytes.length < 24 ? null : size(u32be(16), u32be(20))
    case 'gif':
      return bytes.length < 10 ? null : size(u16le(6), u16le(8))
    case 'webp': {
      if (bytes.length < 30) return null
      const chunk = String.fromCharCode(at(12), at(13), at(14), at(15))
      if (chunk === 'VP8 ') return size(u16le(26) & 0x3fff, u16le(28) & 0x3fff)
      if (chunk === 'VP8L') return size(1 + (((at(22) & 0x3f) << 8) | at(21)), 1 + (((at(24) & 0x0f) << 10) | (at(23) << 2) | ((at(22) & 0xc0) >> 6)))
      if (chunk === 'VP8X') return size(1 + u24le(24), 1 + u24le(27))
      return null
    }
    case 'jpg': {
      // 표지(FF xx)를 따라가다 SOF 를 만나면 거기 높이·너비가 있다
      let i = 2
      while (i + 9 <= bytes.length) {
        if (at(i) !== 0xff) return null
        const marker = at(i + 1)
        if (marker === 0xff) {
          i += 1 // 채움 바이트
          continue
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return size(u16be(i + 7), u16be(i + 5))
        if (marker === 0xd9 || marker === 0xda) return null // SOF 없이 이미지 데이터·끝
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
          i += 2 // 길이 없는 표지
          continue
        }
        i += 2 + u16be(i + 2)
      }
      return null
    }
  }
}

export function extOf(name: string): ImageExt | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return ext in IMAGE_TYPES ? (ext as ImageExt) : null
}

/** Markdown/HTML 표의 실제 이미지만 센다. 코드 속 예시는 파일 참조가 아니다. */
export function referencedImages(folder: string, body: string, conservative = false) {
  const out = new Set<string>()
  for (const { src: raw } of imageRefs(body, conservative)) {
    let src = raw
    try {
      src = src.startsWith('/api/files/') ? '/api/files/' + decodeURIComponent(src.slice('/api/files/'.length)) : decodeURI(src)
    } catch { /* 잘못된 인코딩은 원문 그대로 검사한다 */ }
    const path = src.startsWith('/api/files/')
      ? normalizePath(src.slice('/api/files/'.length))
      : isRelativeSrc(src) ? normalizePath(folder ? `${folder}/${src}` : src) : null
    if (path && !path.split('/').some(part => part.startsWith('.') || /[\\\0]/.test(part)) && /(?:^|\/)assets\/[^/]+$/.test(path) && extOf(path)) out.add(path)
  }
  return out
}

/**
 * 원본 이미지 (설계문서 §4 — 2026-10-07). 화면에 쓰는 줄인 이미지 `assets/<ulid>.<ext>` 옆에 `assets/<ulid>.orig.<ext>`.
 * 본문은 원본을 참조하지 않는다 — 원본은 «같은 이름의 화면 이미지»에 딸린 파일로 다룬다(옮기기·정리).
 */
const ORIGINAL = /\.orig\.[a-z0-9]+$/i

export function isOriginalName(name: string) {
  return ORIGINAL.test(name)
}

/** 내려받을 때의 파일 이름 — 원본이면 `.orig` 를 뺀다: `…/<ulid>.orig.jpg` → `<ulid>.jpg` */
export function downloadNameOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.orig(\.[a-z0-9]+)$/i, '$1')
}

/** 확장자(원본이면 `.orig.<ext>`)를 뗀 경로 — 화면 이미지와 그 원본이 같은 값을 갖는다 */
export function stemOf(path: string) {
  if (ORIGINAL.test(path)) return path.replace(ORIGINAL, '')
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  return dot > slash ? path.slice(0, dot) : path
}
