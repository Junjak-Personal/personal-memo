import type { Editor } from '@tiptap/vue-3'
import { originalOfDisplay } from '#shared/utils/asset-path'
import { prepareImage, type PreparedImage } from '~/utils/image-resize'

interface MemoImageContext {
  getEditor: () => Editor | undefined
  currentMemoId: () => string
}

/** 이미지 블록·붙여넣기·drop이 같은 업로드/원본 보존 경로를 쓴다. 저장 상태는 문서가 관리한다. */
export function useMemoImages(context: MemoImageContext) {
  const toast = useToast()

  /** 브라우저에서 줄여서 이 메모 폴더의 assets/ 로 올린다(줄였으면 원본도). */
  async function uploadImage(file: Blob, name = 'image') {
    return uploadPrepared(await prepareImage(file), name)
  }

  async function uploadPrepared(image: PreparedImage, name = 'image') {
    const body = new FormData()
    body.append('file', image.display, name)
    if (image.original) body.append('original', image.original, name)
    // 제목 저장으로 메모 ID가 바뀔 수 있으므로 실제 전송 직전에 읽는다.
    const id = context.currentMemoId()
    const { src } = await $fetch<{ src: string }>(`/api/memos/${encodeURIComponent(id)}/images`, { method: 'POST', body })
    if (image.originalSkipped) {
      toast.add({
        color: 'warning',
        title: '줄인 이미지만 저장했습니다',
        description: image.originalSkipped === 'size' ? '원본이 30MB 를 넘어 보관하지 못했습니다.' : '이 형식(HEIC 등)은 원본을 보관하지 못합니다.',
      })
    }
    return src
  }

  /** 이미지가 없으면 false — 편집기의 원래 붙여넣기/drop 동작에 맡긴다. */
  function insertImageFiles(files: File[], at?: number) {
    const images = files.filter((file) => file.type.startsWith('image/'))
    const editor = context.getEditor()
    if (!images.length || !editor) return false
    void (async () => {
      for (const file of images) {
        try {
          const src = await uploadImage(file, file.name)
          const chain = editor.chain().focus()
          ;(at === undefined ? chain.setImage({ src }) : chain.insertContentAt(at, { type: 'image', attrs: { src } })).run()
        } catch (error) {
          toast.add({ color: 'error', title: apiMessage(error, `「${file.name}」 을 올리지 못했습니다`) })
        }
      }
    })()
    return true
  }

  /** 다른 폴더 이미지의 표시본·보관 원본을 현재 메모 assets/로 복사한 뒤 src를 바꾼다. */
  async function rehomeForeignImages(editor: Editor) {
    const foreign = new Set<string>()
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('/api/files/')) foreign.add(node.attrs.src)
    })
    for (const src of foreign) {
      try {
        const display = await $fetch<Blob>(src, { responseType: 'blob' })
        const originalSrc = originalOfDisplay(src)
        const originalRes = originalSrc ? await $fetch.raw<Blob>(originalSrc, { responseType: 'blob' }) : null
        const original = originalRes?.headers.get('x-memo-original') === 'stored' ? (originalRes._data ?? null) : null
        const next = await uploadPrepared({ display, original, originalSkipped: null })
        // 업로드 도중 문서가 바뀔 수 있어 이전 위치 대신 src로 다시 찾는다.
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'image' && node.attrs.src === src) {
            editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: next }))
          }
        })
      } catch (error) {
        toast.add({ color: 'error', title: apiMessage(error, '다른 폴더의 이미지를 가져오지 못했습니다') })
      }
    }
  }

  function onPaste() {
    const editor = context.getEditor()
    if (editor) setTimeout(() => rehomeForeignImages(editor))
  }

  return { uploadImage, insertImageFiles, onPaste }
}
