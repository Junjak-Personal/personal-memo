import { attachmentDisposition, downloadAttachment } from '../../memo/attachments'

export default defineMemoHandler(async (event, store) => {
  const { name, size, stream } = await downloadAttachment(store.root, memoIdParam(event))
  setResponseHeaders(event, {
    'content-type': 'application/octet-stream',
    'content-length': size,
    'content-disposition': attachmentDisposition(name),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  return sendStream(event, stream)
})
