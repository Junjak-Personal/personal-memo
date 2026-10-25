/**
 * 이미지 올리기 자리(블록) — nuxt-ui-templates/editor 의 ImageUpload 를 옮겼다.
 * 올리는 방법(upload)은 밖에서 받는다: 메모마다 올릴 곳(/api/memos/:id/images)이 다르다.
 * 업로드 전 자리도 본문에 보관한다. 파일을 올리면 상대경로 src 를 가진 image 로 바뀐다.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ImageUploadNode from './ImageUploadNode.vue'

const IMAGE_UPLOAD_MARKER = '<div data-type="image-upload"></div>'

export interface ImageUploadOptions {
  /** 파일 → 본문에 넣을 src (`assets/…`) */
  upload: (file: File) => Promise<string>
}

export const ImageUpload = Node.create<ImageUploadOptions>({
  name: 'imageUpload',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return { upload: () => Promise.reject(new Error('upload 가 설정되지 않았습니다')) }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-upload' })]
  },
  // 파일 선택을 취소하거나 아직 올리지 않았어도 저장·화면 전환 뒤 같은 자리에서 다시 선택한다.
  renderMarkdown: () => IMAGE_UPLOAD_MARKER,
  markdownTokenizer: {
    name: 'imageUpload',
    level: 'block',
    start: source => source.search(/^<div data-type="image-upload"><\/div>(?=\r?$)/m),
    tokenize(source) {
      const match = /^<div data-type="image-upload"><\/div>(?=\r?\n|$)/.exec(source)
      return match ? { type: 'imageUpload', raw: match[0] } : undefined
    },
  },
  parseMarkdown(_token, helpers) {
    return helpers.createNode('imageUpload')
  },
  addNodeView() {
    return VueNodeViewRenderer(ImageUploadNode)
  },
})
