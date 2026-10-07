/**
 * 이미지 판별과 본문 속 이미지 참조 (설계문서 §4).
 */
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

export function extOf(name: string): ImageExt | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return ext in IMAGE_TYPES ? (ext as ImageExt) : null
}

/** `![alt](src)` / `![alt](<src> "title")` 의 src */
const IMAGE_REF = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

/**
 * 본문이 참조하는 이미지의 `memos/` 기준 경로들.
 * 상대경로만 센다. `../다른폴더/assets/x.jpg` 처럼 다른 폴더를 가리켜도 센다 — 다른 도구로 쓴
 * 참조까지 세야 휴지통 비우기가 남의 이미지를 지우지 않는다.
 */
export function referencedImages(folder: string, body: string) {
  const out = new Set<string>()
  for (const m of body.matchAll(IMAGE_REF)) {
    let src = m[1]!
    try {
      src = decodeURI(src)
    } catch {
      // 잘못된 % 인코딩 — 적힌 그대로 쓴다
    }
    if (!isRelativeSrc(src)) continue
    const path = normalizePath(folder ? `${folder}/${src}` : src)
    if (path) out.add(path)
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
