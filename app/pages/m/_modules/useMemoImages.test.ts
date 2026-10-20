import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/vue-3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareImage } from '~/utils/image-resize'
import type { PreparedImage } from '~/utils/image-resize'
import { useMemoImages } from './useMemoImages'

vi.mock('~/utils/image-resize', () => ({ prepareImage: vi.fn() }))

interface FetchOptions { method?: string; body?: FormData; responseType?: string }
type Fetch = (path: string, options: FetchOptions) => Promise<unknown>
interface Insert { at?: number; src: string }
interface Toast { color?: string; title: string; description?: string }
const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*' },
  image: { group: 'block', attrs: { src: {}, alt: { default: null } } },
} })

function editorFixture(sources: string[] = []) {
  let state = EditorState.create({ doc: schema.node('doc', null, sources.length
    ? sources.map(src => schema.node('image', { src, alt: '그림' }))
    : schema.node('paragraph')) })
  const inserted: Insert[] = []
  const dispatched: number[] = []
  class Chain {
    focus() { return this }
    setImage(attrs: { src: string }) { inserted.push({ src: attrs.src }); return this }
    insertContentAt(at: number, node: { attrs: { src: string } }) { inserted.push({ at, src: node.attrs.src }); return this }
    run() { return true }
  }
  const stub = {
    get state() { return state },
    chain: () => new Chain(),
    view: { dispatch: (tr: EditorState['tr']) => { dispatched.push(tr.steps.length); state = state.apply(tr) } },
  }
  // DOM editor 대신 실제 ProseMirror 문서/transaction과 필요한 command 경계만 제공한다.
  const editor = stub as unknown as Editor
  return {
    editor, inserted, dispatched,
    moveDocument: (sources: string[]) => {
      state = EditorState.create({ doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('앞으로 이동')), ...sources.map(src => schema.node('image', { src, alt: '그림' }))]) })
    },
    sources: () => {
      const result: string[] = []
      state.doc.descendants(node => { if (node.type.name === 'image') result.push(String(node.attrs.src)) })
      return result
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('메모 이미지의 공통 업로드·붙여넣기 경계', () => {
  const display = new Blob(['display'], { type: 'image/webp' })
  const original = new Blob(['original'], { type: 'image/png' })
  let fetch: ReturnType<typeof vi.fn<Fetch>>
  let raw: ReturnType<typeof vi.fn<Fetch>>
  let toast: ReturnType<typeof vi.fn<(value: Toast) => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(prepareImage).mockReset().mockResolvedValue({ display, original: null, originalSkipped: null })
    fetch = vi.fn<Fetch>().mockResolvedValue({ src: 'assets/new.webp' })
    raw = vi.fn<Fetch>().mockResolvedValue({ headers: new Headers(), _data: original })
    toast = vi.fn<(value: Toast) => void>()
    vi.stubGlobal('$fetch', Object.assign(fetch, { raw }))
    vi.stubGlobal('useToast', () => ({ add: toast }))
    vi.stubGlobal('apiMessage', (_error: unknown, fallback: string) => fallback)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('변환을 기다린 뒤 최신 메모 ID로 표시본과 원본을 같은 이름으로 전송한다', async () => {
    const prepared = deferred<PreparedImage>()
    vi.mocked(prepareImage).mockReturnValue(prepared.promise)
    let id = 'old'
    const images = useMemoImages({ getEditor: () => undefined, currentMemoId: () => id })
    const file = new Blob(['input'], { type: 'image/png' })
    const saving = images.uploadImage(file, '한글 사진.png')
    id = 'p:폴더/새 메모.md'
    prepared.resolve({ display, original, originalSkipped: null })
    expect(await saving).toBe('assets/new.webp')
    expect(prepareImage).toHaveBeenCalledWith(file)
    const [path, options] = fetch.mock.calls[0]!
    expect(path).toBe(`/api/memos/${encodeURIComponent(id)}/images`)
    expect(options.method).toBe('POST')
    expect(options.body?.get('file')).toMatchObject({ name: '한글 사진.png', size: display.size, type: display.type })
    expect(options.body?.get('original')).toMatchObject({ name: '한글 사진.png', size: original.size, type: original.type })
    expect(toast).not.toHaveBeenCalled()
  })

  it.each([
    ['size', '원본이 30MB 를 넘어 보관하지 못했습니다.'],
    ['type', '이 형식(HEIC 등)은 원본을 보관하지 못합니다.'],
  ] as const)('원본 보관 생략 사유 %s는 성공한 업로드 뒤 경고한다', async (originalSkipped, description) => {
    vi.mocked(prepareImage).mockResolvedValue({ display, original: null, originalSkipped })
    await useMemoImages({ getEditor: () => undefined, currentMemoId: () => 'one' }).uploadImage(original)
    expect(fetch.mock.calls[0]![1].body?.get('file')).toMatchObject({ name: 'image' })
    expect(fetch.mock.calls[0]![1].body?.has('original')).toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ color: 'warning', title: '줄인 이미지만 저장했습니다', description })
  })

  it('업로드 실패를 호출자에게 전달하며 성공 경고를 표시하지 않는다', async () => {
    const error = new Error('upload failed')
    fetch.mockRejectedValue(error)
    vi.mocked(prepareImage).mockResolvedValue({ display, original: null, originalSkipped: 'size' })
    await expect(useMemoImages({ getEditor: () => undefined, currentMemoId: () => 'one' }).uploadImage(original)).rejects.toBe(error)
    expect(toast).not.toHaveBeenCalled()
  })

  it('에디터나 이미지가 없으면 기본 동작에 맡기며 요청하지 않는다', () => {
    const text = new File(['text'], 'text.txt', { type: 'text/plain' })
    const image = new File(['image'], 'photo.png', { type: 'image/png' })
    expect(useMemoImages({ getEditor: () => undefined, currentMemoId: () => 'one' }).insertImageFiles([image])).toBe(false)
    expect(useMemoImages({ getEditor: () => editorFixture().editor, currentMemoId: () => 'one' }).insertImageFiles([text])).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('이미지 파일만 순서대로 보내고 도중 editor 참조가 바뀌어도 원래 editor의 drop 위치 0에 넣는다', async () => {
    const first = deferred<{ src: string }>()
    fetch.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ src: 'assets/two.webp' })
    const opening = editorFixture()
    const next = editorFixture()
    let current = opening.editor
    const images = useMemoImages({ getEditor: () => current, currentMemoId: () => 'one' })
    expect(images.insertImageFiles([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['x'], 'x.txt', { type: 'text/plain' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ], 0)).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    current = next.editor
    first.resolve({ src: 'assets/one.webp' })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(opening.inserted).toEqual([{ at: 0, src: 'assets/one.webp' }, { at: 0, src: 'assets/two.webp' }])
    expect(next.inserted).toEqual([])
  })

  it('파일 하나가 실패해도 다음 이미지는 선택 위치에 넣고 파일 이름으로 오류를 알린다', async () => {
    fetch.mockRejectedValueOnce(new Error('bad')).mockResolvedValueOnce({ src: 'assets/two.webp' })
    const doc = editorFixture()
    const images = useMemoImages({ getEditor: () => doc.editor, currentMemoId: () => 'one' })
    expect(images.insertImageFiles([new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })])).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(doc.inserted).toEqual([{ src: 'assets/two.webp' }])
    expect(toast).toHaveBeenCalledWith({ color: 'error', title: '「a.png」 을 올리지 못했습니다' })
  })

  it('붙여넣기 뒤 src를 중복 제거해 원본 헤더를 확인하고 업로드 후 현재 문서 위치를 다시 찾는다', async () => {
    const foreign = '/api/files/다른/assets/one.webp'
    const local = 'assets/local.webp'
    const doc = editorFixture([foreign, foreign, local, 'https://example.com/image.png'])
    raw.mockResolvedValue({ headers: new Headers({ 'x-memo-original': 'stored' }), _data: original })
    const upload = deferred<{ src: string }>()
    fetch.mockResolvedValueOnce(display).mockReturnValueOnce(upload.promise)
    const images = useMemoImages({ getEditor: () => doc.editor, currentMemoId: () => 'one' })
    images.onPaste()
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(raw).toHaveBeenCalledExactlyOnceWith('/api/originals/다른/assets/one.webp', { responseType: 'blob' })
    expect(fetch.mock.calls[1]![1].body?.get('original')).toMatchObject({ size: original.size })
    doc.moveDocument([foreign, local, foreign])
    upload.resolve({ src: 'assets/copied.webp' })
    await vi.advanceTimersByTimeAsync(0)
    expect(doc.sources()).toEqual(['assets/copied.webp', local, 'assets/copied.webp'])
    expect(doc.dispatched).toEqual([1, 1])
    expect(prepareImage).not.toHaveBeenCalled()
  })

  it.each([null, 'fallback'])('저장 원본 헤더가 %s면 표시본만 다시 올린다', async (header) => {
    const doc = editorFixture(['/api/files/other/assets/one.png'])
    raw.mockResolvedValue({ headers: new Headers(header ? { 'x-memo-original': header } : {}), _data: original })
    fetch.mockResolvedValueOnce(display).mockResolvedValueOnce({ src: 'assets/copied.webp' })
    useMemoImages({ getEditor: () => doc.editor, currentMemoId: () => 'one' }).onPaste()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch.mock.calls[1]![1].body?.has('original')).toBe(false)
    expect(doc.sources()).toEqual(['assets/copied.webp'])
  })

  it('외부 이미지 재업로드가 실패해도 다음 src는 처리하며 에디터가 없으면 예약하지 않는다', async () => {
    const one = '/api/files/other/assets/one.png'
    const two = '/api/files/other/assets/two.png'
    const doc = editorFixture([one, two])
    fetch.mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce(display).mockResolvedValueOnce({ src: 'assets/two.webp' })
    useMemoImages({ getEditor: () => undefined, currentMemoId: () => 'one' }).onPaste()
    expect(vi.getTimerCount()).toBe(0)
    useMemoImages({ getEditor: () => doc.editor, currentMemoId: () => 'one' }).onPaste()
    await vi.advanceTimersByTimeAsync(0)
    expect(doc.sources()).toEqual([one, 'assets/two.webp'])
    expect(toast).toHaveBeenCalledWith({ color: 'error', title: '다른 폴더의 이미지를 가져오지 못했습니다' })
  })
})
