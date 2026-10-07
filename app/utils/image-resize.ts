/**
 * 업로드 전 브라우저에서 줄인다 — 서버에는 이미지 라이브러리가 없다 (설계문서 §4, pic-blog resize.ts 와 같은 방식).
 * 줄였으면 원본도 같이 올려 보관한다 (2026-10-07). 줄이지 않았으면 올린 것이 곧 원본이다.
 */
export const DISPLAY_MAX = 2048

/** 이 크기 이하이고 2048px 안이면 그대로 올린다 — 스크린샷 글자가 재압축으로 뭉개지지 않게 */
const KEEP_AS_IS_BYTES = 2 * 1024 * 1024

/** 서버가 원본으로 받는 형식 (server/memo/images.ts 의 sniffImage 와 같다). HEIC 등은 원본을 두지 못한다 */
const ORIGINAL_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
export const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024

export interface PreparedImage {
  display: Blob
  /** 줄였을 때의 원본. 줄이지 않았으면 null (display 가 원본) */
  original: Blob | null
  /** 줄였지만 원본을 보관하지 못하는 이유 — 화면이 알린다 */
  originalSkipped: 'type' | 'size' | null
}

let cachedType: 'image/webp' | 'image/jpeg' | null = null

/** 이 브라우저가 WebP 로 인코딩할 수 있는가. 아이폰 사파리는 못 한다 (pic-blog 실측) */
function outputType() {
  cachedType ??= document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
  return cachedType
}

function scaleTo(w: number, h: number, max: number) {
  if (w <= max && h <= max) return { w, h }
  const r = w >= h ? max / w : max / h
  return { w: Math.round(w * r), h: Math.round(h * r) }
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const display = await resizeForUpload(file)
  if (display === file) return { display, original: null, originalSkipped: null }
  if (!ORIGINAL_TYPES.has(file.type)) return { display, original: null, originalSkipped: 'type' }
  if (file.size > MAX_ORIGINAL_BYTES) return { display, original: null, originalSkipped: 'size' }
  return { display, original: file, originalSkipped: null }
}

async function resizeForUpload(file: Blob): Promise<Blob> {
  // 움직이는 GIF 는 canvas 를 거치면 첫 장만 남는다
  if (file.type === 'image/gif') return file
  /*
   * 🔴 imageOrientation: 'from-image' 가 없으면 canvas 가 EXIF 회전을 무시해 아이폰 세로 사진이 눕는다.
   */
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const { w, h } = scaleTo(bitmap.width, bitmap.height, DISPLAY_MAX)
    if (w === bitmap.width && file.size <= KEEP_AS_IS_BYTES && file.type !== 'image/heic') return file
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context 를 만들지 못했습니다')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    const type = outputType()
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지를 변환하지 못했습니다'))), type, type === 'image/webp' ? 0.8 : 0.82)
    })
  } finally {
    bitmap.close()
  }
}
