/**
 * 이미지 판별과 본문 속 이미지 참조 (설계문서 §4).
 */
import { isRelativeSrc, normalizePath } from '../../shared/utils/asset-path'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

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
