import type { JSONContent } from '@tiptap/core'

const MAX_IMAGE_SIZE = 10_000

/** 이미지 HTML과 노드 속성은 외부 입력이다. 유효한 픽셀 크기만 저장한다. */
export function memoImageDimension(value: unknown): number | null {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN
  return Number.isInteger(number) && number > 0 && number <= MAX_IMAGE_SIZE ? number : null
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;')
}

/** 일반 이미지는 기존 Markdown을 쓴다. 크기나 복잡한 설명이 있으면 손실 없이 HTML로 쓴다. */
export function memoImageMarkdown(node: JSONContent): string | undefined {
  const width = memoImageDimension(node.attrs?.width)
  const height = memoImageDimension(node.attrs?.height)
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  const title = typeof node.attrs?.title === 'string' ? node.attrs.title : ''
  if (!width && !height && !/[\\[\]<>\r\n]/.test(alt) && !/["\\\r\n]/.test(title) && !/["\\()<>\s]/.test(src)) return undefined
  const attrs = [`src="${escapeAttribute(src)}"`, `alt="${escapeAttribute(alt)}"`]
  if (title) attrs.push(`title="${escapeAttribute(title)}"`)
  if (width) attrs.push(`width="${width}"`)
  if (height) attrs.push(`height="${height}"`)
  return `<img ${attrs.join(' ')}>`
}

/** 가로 크기만 바꿔도 원래 비율을 유지한다. 이미지가 아직 없으면 크기를 추측하지 않는다. */
export function imageHeightForWidth(width: number, originalWidth: number | null, originalHeight: number | null) {
  if (!memoImageDimension(width) || !originalWidth || !originalHeight) return null
  return memoImageDimension(Math.max(1, Math.round(width * originalHeight / originalWidth)))
}
