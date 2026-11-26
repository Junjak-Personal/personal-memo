import { createRequire } from 'node:module'
import type { JSONContent } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentDownload, AttachmentUpload } from './AttachmentUploadExtension'
import { ImageUpload } from './ImageUploadExtension'

vi.mock('./AttachmentUploadNode.vue', () => ({ default: {} }))
vi.mock('./ImageUploadNode.vue', () => ({ default: {} }))

const require = createRequire(import.meta.resolve('@nuxt/ui'))
const { MarkdownManager } = require('@tiptap/markdown')
const { StarterKit } = require('@tiptap/starter-kit')
const marker = '<div data-type="image-upload"></div>'
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const manager = () => new MarkdownManager({ extensions: [StarterKit, ImageUpload, Image] })

describe('업로드 전 이미지 자리의 저장·다시 열기', () => {
  it('파일을 올리지 않아도 이미지 자리를 본문 사이에 저장하고 다시 읽는다', () => {
    const md = manager()
    const source = doc(paragraph('앞'), { type: 'imageUpload' }, paragraph('뒤'))
    const stored = md.serialize(source)
    expect(stored).toBe(`앞\n\n${marker}\n\n뒤`)
    expect(md.parse(stored)).toEqual(source)
  })

  it('빈 이미지 자리 여러 개와 자리만 있는 메모도 반복 저장에서 유지한다', () => {
    const md = manager()
    for (const source of [doc({ type: 'imageUpload' }), doc({ type: 'imageUpload' }, { type: 'imageUpload' })]) {
      const stored = md.serialize(source)
      expect(md.parse(stored)).toEqual(source)
      expect(md.serialize(md.parse(stored))).toBe(stored)
    }
  })

  it('업로드된 이미지·일반 문단·코드 안의 표시는 기존 방식대로 처리한다', () => {
    const md = manager()
    const old = new MarkdownManager({ extensions: [StarterKit, Image] })
    for (const source of ['![사진](assets/photo.png)', '보통 **메모**', `\`${marker}\``, `\`\`\`html\n${marker}\n\`\`\``]) {
      expect(md.parse(source)).toEqual(old.parse(source))
      expect(md.serialize(md.parse(source))).toBe(old.serialize(old.parse(source)))
    }
  })
})

describe('파일 첨부의 Markdown 저장·다시 열기', () => {
  const md = new MarkdownManager({ extensions: [StarterKit, AttachmentUpload, AttachmentDownload, ImageUpload, Image] })
  const attachmentMarker = '<div data-type="attachment-upload"></div>'

  it('여러 첨부 자리를 제 위치에 저장하고 업로드를 식별하는 개별 ID는 문서에 쓰지 않는다', () => {
    const source = `앞\n\n${attachmentMarker}\n\n${attachmentMarker}\n\n뒤`
    const parsed = md.parse(source)
    const [first, second] = parsed.content.filter((node: JSONContent) => node.type === 'attachmentUpload')
    expect(first.attrs.uploadId).toBeTruthy()
    expect(first.attrs.uploadId).not.toBe(second.attrs.uploadId)
    expect(md.serialize(parsed)).toBe(source)
  })

  it('한글·공백·Markdown 문자가 들어 있는 첨부 이름을 그대로 보이는 링크로 복구한다', () => {
    const href = '/api/attachments/01M5D265Y7R61BQEFWDT6RA27E'
    const name = '한글  [첨부] (검토) * &copy; ` _~.pdf'
    const source = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: name, marks: [{ type: 'link', attrs: { href } }] }],
    })
    const stored = md.serialize(source)
    const parsed = md.parse(stored)
    expect(parsed.content[0].content[0]).toMatchObject({ text: name, marks: [{ type: 'link', attrs: { href } }] })
    expect(md.serialize(parsed)).toBe(stored)
  })
})
