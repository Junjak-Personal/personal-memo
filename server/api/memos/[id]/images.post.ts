import { MemoError } from '../../../memo/errors'
import { MAX_IMAGE_BYTES } from '../../../memo/images'

/** multipart 의 `file` 한 장. 크기는 본문을 읽기 전에 먼저 본다 — 큰 요청을 메모리에 올리지 않는다 */
export default defineMemoHandler(async (event, store) => {
  const length = Number(getRequestHeader(event, 'content-length') ?? 0)
  // multipart 머리·경계 문자열만큼 여유를 둔다
  if (length > MAX_IMAGE_BYTES + 64 * 1024) throw new MemoError('too_large', '이미지는 10MB 까지입니다')
  const parts = await readMultipartFormData(event)
  const file = parts?.find((p) => p.name === 'file')
  if (!file) throw new MemoError('bad_request', 'file 이 없습니다')
  return store.saveImage(memoIdParam(event), new Uint8Array(file.data))
})
