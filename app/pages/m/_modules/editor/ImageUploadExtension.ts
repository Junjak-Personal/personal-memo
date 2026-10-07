/**
 * 이미지 올리기 자리(블록) — nuxt-ui-templates/editor 의 ImageUpload 를 옮겼다.
 * 올리는 방법(upload)은 밖에서 받는다: 메모마다 올릴 곳(/api/memos/:id/images)이 다르다.
 * 이 블록은 올리는 동안만 있다 — 끝나면 상대경로 src 를 가진 image 로 바뀐다. 마크다운으로는 쓰이지 않는다.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import ImageUploadNode from './ImageUploadNode.vue'

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
  // 저장하는 순간 아직 올리는 중이면 아무것도 쓰지 않는다
  renderMarkdown: () => '',
  addNodeView() {
    return VueNodeViewRenderer(ImageUploadNode)
  },
})
