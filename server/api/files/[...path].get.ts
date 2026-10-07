import { createReadStream } from 'node:fs'

/**
 * 본문 속 이미지 (설계문서 §4). 로그인한 사람만 연다 (server/middleware/auth.ts).
 * 이름이 ULID 라 내용이 바뀌지 않는다 — 오래 캐시한다.
 */
export default defineMemoHandler(async (event, store) => {
  const rel = getRouterParam(event, 'path', { decode: true }) ?? ''
  const file = await store.imageFile(rel)
  setResponseHeaders(event, {
    'content-type': file.type,
    'content-length': file.size,
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
  })
  return sendStream(event, createReadStream(file.abs))
})
