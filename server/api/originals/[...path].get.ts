import { createReadStream } from 'node:fs'

/**
 * 화면 이미지의 원본 (설계문서 §4). 주소는 화면 이미지와 같다 — `/api/originals/<폴더>/assets/<ulid>.<ext>`.
 * 따로 보관한 원본이 없으면 화면 이미지를 그대로 준다(그게 원본이다). `x-memo-original: stored | none` 으로 알린다.
 */
export default defineMemoHandler(async (event, store) => {
  const rel = getRouterParam(event, 'path', { decode: true }) ?? ''
  const file = await store.originalImageFile(rel)
  setResponseHeaders(event, {
    'content-type': file.type,
    'content-length': file.size,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'x-memo-original': file.stored ? 'stored' : 'none',
  })
  return sendStream(event, createReadStream(file.abs))
})
