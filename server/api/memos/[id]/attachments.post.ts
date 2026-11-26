import { ATTACHMENT_NAME_HEADER, MAX_ATTACHMENT_BYTES } from '../../../../shared/utils/attachments'
import { readAttachmentName, saveAttachment } from '../../../memo/attachments'
import { MemoError } from '../../../memo/errors'

export default defineMemoHandler(async (event, store) => {
  if (getRequestHeader(event, 'content-type') !== 'application/octet-stream') {
    throw new MemoError('unsupported_type', '첨부파일을 읽을 수 없습니다')
  }
  const header = getRequestHeader(event, 'content-length') ?? ''
  if (!/^\d+$/.test(header)) throw new MemoError('bad_request', '첨부파일 크기를 확인할 수 없습니다')
  const length = Number(header)
  if (length > MAX_ATTACHMENT_BYTES) throw new MemoError('too_large', '첨부파일은 30MB까지 올릴 수 있습니다')

  const name = readAttachmentName(getRequestHeader(event, ATTACHMENT_NAME_HEADER) ?? '')
  const memo = await store.get(memoIdParam(event))
  if (memo.unreadable) throw new MemoError('unreadable', '읽을 수 없는 메모에는 파일을 첨부할 수 없습니다')
  const bytes = (await readRawBody(event, false)) ?? new Uint8Array()
  if (bytes.byteLength !== length) throw new MemoError('bad_request', '첨부파일 크기가 일치하지 않습니다')

  return saveAttachment(store.root, { name, bytes })
})
