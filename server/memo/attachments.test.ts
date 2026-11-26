import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buffer } from 'node:stream/consumers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachmentIdFromHref, MAX_ATTACHMENT_BYTES } from '../../shared/utils/attachments'
import { attachmentDisposition, downloadAttachment, readAttachmentName, saveAttachment } from './attachments'

describe('메모 첨부파일', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'memo-attachment-test-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('동일한 이름의 첨부를 다른 ID로 보관하고 빈 파일과 바이너리를 그대로 돌려준다', async () => {
    const name = '한글 [첨부] (검토) &copy; "23".bin'
    const bytes = Uint8Array.of(0, 13, 255, 39, 127)
    const files = await Promise.all([
      saveAttachment(root, { name, bytes }),
      saveAttachment(root, { name, bytes: new Uint8Array() }),
    ])
    expect(files[0].href).not.toBe(files[1].href)
    expect(await readdir(join(root, '.attachments'))).toHaveLength(2)
    for (const [index, { href }] of files.entries()) {
      const id = attachmentIdFromHref(href)
      if (!id) throw new Error('첨부 주소에 ID가 없습니다')
      const file = await downloadAttachment(root, id)
      const data = await buffer(file.stream)
      expect(file.name).toBe(name)
      expect(file.size).toBe(index === 0 ? bytes.length : 0)
      expect(data).toEqual(Buffer.from(index === 0 ? bytes : []))
    }
  })

  it('잘못된 파일명 및 크기 제한 초과를 쓰기 전에 거절하고 이름을 안전한 응답 헤더로 보낸다', async () => {
    const name = ' 한글 [A]()! %.pdf '
    const disposition = attachmentDisposition(name)
    expect(readAttachmentName(encodeURIComponent(name))).toBe(name)
    expect(disposition).toMatch(/^attachment; filename="[a-zA-Z0-9._ -]+"; filename\*=UTF-8''/)
    expect(disposition).toContain('%28%29%21')
    expect(decodeURIComponent(disposition.split("UTF-8''")[1] ?? '')).toBe(name)
    for (const invalid of ['%', ' ', '..', 'memo%2Ffile', 'memo%5Cfile', 'memo%0D%0Afile']) {
      expect(() => readAttachmentName(invalid)).toThrow('첨부파일 이름')
    }
    await expect(saveAttachment(root, { name, bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) })).rejects.toMatchObject({ status: 413 })
    expect(await readdir(root)).toEqual([])
  })

  it('같은 저장소의 다른 디렉터리나 파일을 가리키는 심볼릭 링크는 내려주지 않는다', async () => {
    const { href } = await saveAttachment(root, { name: '문서.bin', bytes: Uint8Array.of(21) })
    const id = attachmentIdFromHref(href)
    if (!id) throw new Error('첨부 주소에 ID가 없습니다')
    const parent = join(root, '.attachments')
    const dir = join(parent, id)
    const unrelated = join(root, 'other')
    await mkdir(unrelated)
    await writeFile(join(unrelated, 'name'), '다른 첨부.bin')
    await writeFile(join(unrelated, 'contents'), Uint8Array.of(12))
    await rm(join(dir, 'contents'))
    await symlink(join(unrelated, 'contents'), join(dir, 'contents'))
    await expect(downloadAttachment(root, id)).rejects.toMatchObject({ status: 404 })
    await rm(dir, { recursive: true })
    await symlink(unrelated, dir)
    await expect(downloadAttachment(root, id)).rejects.toMatchObject({ status: 404 })
    await expect(downloadAttachment(root, '../other')).rejects.toMatchObject({ status: 404 })
  })
})
