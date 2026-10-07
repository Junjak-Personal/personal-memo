import { MemoError } from '../../../memo/errors'
import { MAX_IMAGE_BYTES, MAX_ORIGINAL_BYTES } from '../../../memo/images'

/**
 * multipart 의 `file`(화면용) 한 장 + 있으면 `original`(줄이기 전 원본).
 * 크기는 본문을 읽기 전에 먼저 본다 — 큰 요청을 메모리에 올리지 않는다.
 */
export default defineMemoHandler(async (event, store) => {
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  // multipart 머리·경계 문자열만큼 여유를 둔다
  if (length > MAX_IMAGE_BYTES + MAX_ORIGINAL_BYTES + 128 * 1024) throw new MemoError('too_large', '이미지가 너무 큽니다 (화면용 10MB, 원본 30MB 까지)')
  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file')
  if (!file) throw new MemoError('bad_request', 'file 이 없습니다')
  const original = parts?.find((p) => p.name === 'original')
  return store.saveImage(memoIdParam(event), new Uint8Array(file.data), original ? new Uint8Array(original.data) : undefined)
})
