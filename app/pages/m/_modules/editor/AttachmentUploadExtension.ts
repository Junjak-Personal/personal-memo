import { Extension, Node } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { attachmentIdFromHref } from '#shared/utils/attachments'
import { ulid } from '#shared/utils/ulid'
import AttachmentUploadNode from './AttachmentUploadNode.vue'

const marker = '<div data-type="attachment-upload"></div>'

export interface AttachmentUploadOptions {
  upload: (file: File, signal: AbortSignal) => Promise<string>
}

export const AttachmentUpload = Node.create<AttachmentUploadOptions>({
  name: 'attachmentUpload',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return { upload: () => Promise.reject(new Error('파일을 올릴 수 없습니다')) }
  },
  addAttributes() {
    return {
      // 여러 첨부 자리 중 업로드를 시작한 자리가 삭제되었는지 확인한다.
      uploadId: { default: null, rendered: false, parseHTML: () => ulid() },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="attachment-upload"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'attachment-upload' }]
  },
  renderMarkdown: () => marker,
  markdownTokenizer: {
    name: 'attachmentUpload',
    level: 'block',
    start: source => source.search(/^<div data-type="attachment-upload"><\/div>(?=\r?$)/m),
    tokenize(source) {
      const match = /^<div data-type="attachment-upload"><\/div>(?=\r?\n|$)/.exec(source)
      return match ? { type: 'attachmentUpload', raw: match[0] } : undefined
    },
  },
  parseMarkdown(_token, helpers) {
    return helpers.createNode('attachmentUpload', { uploadId: ulid() })
  },
  addNodeView() {
    return VueNodeViewRenderer(AttachmentUploadNode)
  },
})

export const AttachmentDownload = Extension.create({
  name: 'attachmentDownload',
  addGlobalAttributes() {
    return [{
      types: ['link'],
      attributes: {
        attachmentDownload: {
          parseHTML: () => null,
          renderHTML: ({ href }) => typeof href === 'string' && attachmentIdFromHref(href)
            ? { download: '', contenteditable: 'false', tabindex: '0', 'data-testid': 'memo-attachment-download' }
            : {},
        },
      },
    }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          keydown: (_view, event) => {
            const anchor = event.target
            if (event.key !== 'Enter' || event.isComposing || !(anchor instanceof HTMLAnchorElement)
              || !attachmentIdFromHref(anchor.getAttribute('href'))) return false

            event.preventDefault()
            if (!event.repeat) anchor.click()
            return true
          },
        },
      },
    })]
  },
})
