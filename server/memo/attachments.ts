import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { attachmentHref, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_NAME_BYTES } from '../../shared/utils/attachments'
import { isUlid, ulid } from '../../shared/utils/ulid'
import { MemoError } from './errors'
import { writeAtomic } from './fsx'
import { insideRoot } from './paths'

const directory = '.attachments'
const missing = () => new MemoError('not_found', '첨부파일을 찾을 수 없습니다')

function isAttachmentName(name: string) {
  return !!name.trim() && name !== '.' && name !== '..' && !/[\\/\p{Cc}]/u.test(name)
    && Buffer.byteLength(name) <= MAX_ATTACHMENT_NAME_BYTES
}

export function readAttachmentName(header: string) {
  let name: string
  try {
    name = decodeURIComponent(header)
  } catch {
    throw new MemoError('bad_request', '첨부파일 이름을 읽을 수 없습니다')
  }
  if (!isAttachmentName(name)) throw new MemoError('bad_request', '첨부파일 이름을 사용할 수 없습니다')
  return name
}

export function attachmentDisposition(name: string) {
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, '_')
  const utf8 = encodeURIComponent(name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${utf8}`
}

async function requireDirectory(root: string, rel: string) {
  const abs = await insideRoot(root, rel)
  if (!(await lstat(abs).catch(() => null))?.isDirectory()) throw missing()
  return abs
}

export async function saveAttachment(root: string, { name, bytes }: { name: string; bytes: Uint8Array }) {
  if (!isAttachmentName(name)) throw new MemoError('bad_request', '첨부파일 이름을 사용할 수 없습니다')
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new MemoError('too_large', '첨부파일은 30MB까지 올릴 수 있습니다')

  await mkdir(await insideRoot(root, directory), { recursive: true })
  const parent = await requireDirectory(root, directory)
  const id = ulid()
  const target = join(parent, id)
  const staging = await mkdtemp(join(parent, '.upload-'))
  try {
    await writeAtomic(join(staging, 'contents'), bytes)
    await writeAtomic(join(staging, 'name'), name)
    await rename(staging, target)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return { href: attachmentHref(id) }
}

async function openAttachmentFile(root: string, rel: string, limit: number) {
  const abs = await insideRoot(root, rel)
  const file = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null)
  if (!file) throw missing()
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > limit) throw missing()
    return { file, size: stat.size }
  } catch (error) {
    await file.close()
    throw error
  }
}

export async function downloadAttachment(root: string, id: string) {
  if (!isUlid(id)) throw missing()
  const rel = join(directory, id)
  await requireDirectory(root, directory)
  await requireDirectory(root, rel)

  const { file: metadata } = await openAttachmentFile(root, join(rel, 'name'), MAX_ATTACHMENT_NAME_BYTES)
  let name: string
  try {
    name = await metadata.readFile('utf8')
  } finally {
    await metadata.close()
  }
  if (!isAttachmentName(name)) throw missing()
  const { file, size } = await openAttachmentFile(root, join(rel, 'contents'), MAX_ATTACHMENT_BYTES)
  return { name, size, stream: file.createReadStream() }
}
