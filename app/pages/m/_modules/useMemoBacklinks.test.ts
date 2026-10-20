import { ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoMeta } from '#shared/types/memo'
import { useMemoBacklinks } from './useMemoBacklinks'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const row = { id: 'source', title: '합성 참조', folder: '개발' } as MemoMeta
const settle = async () => { await Promise.resolve(); await Promise.resolve() }

describe('백링크 조회 수명', () => {
  const id = ref('target')
  const session = ref<unknown>(null)
  let fetch: ReturnType<typeof vi.fn<(path: string) => Promise<MemoMeta[]>>>
  let mounted: () => void
  let unmount: () => void
  let stops: Array<() => void>
  beforeEach(() => {
    id.value = 'target'
    session.value = { id: 'one', user: { owner: true }, loggedInAt: 1 }
    stops = []
    fetch = vi.fn<(path: string) => Promise<MemoMeta[]>>().mockResolvedValue([row])
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('watch', (...args: Parameters<typeof watch>) => { const stop = watch(...args); stops.push(stop); return stop })
    vi.stubGlobal('onMounted', (callback: () => void) => { mounted = callback })
    vi.stubGlobal('onBeforeUnmount', (callback: () => void) => { unmount = callback })
    vi.stubGlobal('useUserSession', () => ({ session }))
    vi.stubGlobal('apiMessage', (_error: unknown, fallback: string) => fallback)
    vi.stubGlobal('$fetch', fetch)
  })
  afterEach(() => { unmount?.(); for (const stop of stops) stop(); vi.unstubAllGlobals() })

  it('실제로 붙은 문서만 조회하며 준비 대기를 하지 않는다', async () => {
    const h = useMemoBacklinks(() => id.value)
    expect(fetch).not.toHaveBeenCalled()
    mounted()
    expect(h.loading.value).toBe(true)
    await settle()
    expect(h.rows.value).toEqual([row])
    expect(h.loading.value).toBe(false)
  })
  it('문서 변경 전의 늦은 참조 제목을 표시하지 않는다', async () => {
    const old = deferred<MemoMeta[]>()
    fetch.mockReturnValueOnce(old.promise).mockResolvedValueOnce([{ ...row, id: 'new-source' }])
    const h = useMemoBacklinks(() => id.value)
    mounted()
    id.value = 'other'
    await settle()
    old.resolve([row])
    await settle()
    expect(h.rows.value.map(memo => memo.id)).toEqual(['new-source'])
  })
  it('세션 전환이나 종료는 보이는 목록과 늦은 응답을 지운다', async () => {
    const h = useMemoBacklinks(() => id.value)
    mounted()
    await settle()
    expect(h.rows.value).toHaveLength(1)
    const old = deferred<MemoMeta[]>()
    fetch.mockReturnValueOnce(old.promise)
    const refreshing = h.refresh()
    session.value = null
    expect(h.rows.value).toEqual([])
    old.resolve([row])
    await refreshing
    expect(h.rows.value).toEqual([])
    expect(h.loading.value).toBe(false)
  })
  it('실패를 표시하고 새 요청으로 복구하며 종료 후 응답을 버린다', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'))
    const h = useMemoBacklinks(() => id.value)
    mounted()
    await settle()
    expect(h.error.value).toContain('불러오지 못했습니다')
    await h.refresh()
    expect(h.error.value).toBe('')
    expect(h.rows.value).toEqual([row])
    const old = deferred<MemoMeta[]>()
    fetch.mockReturnValueOnce(old.promise)
    const refreshing = h.refresh()
    unmount()
    old.resolve([row])
    await refreshing
    expect(h.rows.value).toEqual([])
  })
})
