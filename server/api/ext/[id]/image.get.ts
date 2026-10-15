import { createReadStream } from 'node:fs'

/**
 * 외부 공개 메모의 이미지 — `?src=<본문 속 경로>`. 그 메모가 본문에서 참조하는 이미지만 준다 (store.publicImage).
 * 공개를 끄면 바로 막혀야 하므로 오래 캐시하지 않는다.
 */
export default defineMemoHandler(async (event, store) => {
  const file = await store.publicImage(memoIdParam(event), queryString(event, 'src'))
  setResponseHeaders(event, {
    'content-type': file.type,
    'content-length': file.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  return sendStream(event, createReadStream(file.abs))
})
