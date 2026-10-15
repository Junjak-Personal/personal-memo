/**
 * MCP 이미지 올리기 (설계문서 §11.1) — create_image_upload 가 준 1회용 링크. 본문은 이미지 바이트 그대로(`curl -T <파일> <링크>`).
 * 로그인 쿠키·접근 토큰 대신 링크가 권한이다: 메모 하나·10분·성공 한 번, 링크를 받은 연결을 끊으면 못 쓴다.
 * 서버는 줄이지 않는다(§4) — 가로·세로가 크면 거절하고 링크는 남긴다(줄여서 다시 올리면 된다).
 */
import { MemoError } from '../../../memo/errors'
import { imageSize, MAX_IMAGE_BYTES, sniffImage } from '../../../memo/images'
import { UPLOAD_MAX_PIXELS } from '../../../mcp/uploads'

const GONE = '올리기 링크가 없거나 만료됐습니다 — create_image_upload 로 새 링크를 받으세요'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  const fail = (status: number, error: string) => {
    setResponseStatus(event, status)
    return { error }
  }

  const token = getRouterParam(event, 'token') ?? ''
  const uploads = useImageUploads()
  const pending = uploads.peek(token)
  if (!pending || !(await useOAuthGrants()).hasConnection(pending.family)) return fail(404, GONE)

  // 길이를 먼저 본다 — 길이 없는(chunked) 본문은 다 읽기 전엔 크기를 모르니 받지 않는다
  const length = Number(getRequestHeader(event, 'content-length'))
  if (!Number.isInteger(length) || length <= 0) return fail(411, '본문 길이(Content-Length)가 필요합니다 — curl -T <파일> <링크> 로 올리세요')
  if (length > MAX_IMAGE_BYTES) return fail(413, '이미지는 10MB 까지입니다')

  const bytes = new Uint8Array((await readRawBody(event, false)) ?? [])
  const ext = sniffImage(bytes)
  if (!ext) return fail(415, 'jpeg, png, gif, webp 만 올릴 수 있습니다')
  const size = imageSize(bytes, ext)
  if (!size) return fail(422, '이미지 크기를 읽지 못했습니다')
  if (size.width > UPLOAD_MAX_PIXELS || size.height > UPLOAD_MAX_PIXELS) {
    return fail(
      413,
      `가로·세로 ${UPLOAD_MAX_PIXELS}px 까지 받습니다 (이 이미지는 ${size.width}×${size.height}). 줄여서 같은 링크로 다시 올리세요 — macOS: sips -Z ${UPLOAD_MAX_PIXELS} <파일> --out <새 파일>`,
    )
  }

  if (!uploads.consume(token)) return fail(404, GONE)
  try {
    const { src } = await (await useMemoStore()).saveImage(pending.memoId, bytes)
    console.info(`[mcp] upload_image ${pending.memoId} (${pending.client})`)
    return { src, markdown: `![](${src})`, width: size.width, height: size.height, bytes: bytes.byteLength }
  } catch (error) {
    if (error instanceof MemoError) return fail(error.status, error.message)
    throw error
  }
})
