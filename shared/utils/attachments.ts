import { isUlid } from './ulid'

export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024
export const MAX_ATTACHMENT_NAME_BYTES = 1024
export const ATTACHMENT_NAME_HEADER = 'x-memo-filename'

const attachmentRoute = '/api/attachments/'

export function attachmentHref(id: string) {
  return `${attachmentRoute}${id}`
}

export function attachmentIdFromHref(href: string | null) {
  if (!href?.startsWith(attachmentRoute)) return null
  const id = href.slice(attachmentRoute.length)
  return isUlid(id) ? id : null
}
