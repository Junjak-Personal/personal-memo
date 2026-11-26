import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Memo, MemoInput } from '#shared/types/memo'
import { readDraft, writeDraft } from '~/utils/memo-drafts'
import { useMemoAutosave } from './useMemoAutosave'

const original: Memo = { id: 'synthetic-autosave', path: '합성.md', folder: '', title: '합성', content: '처음', version: 'v1', created: null, updated: null, date: null, dateEnd: null, tags: [], done: null, priority: 'medium', public: false, unreadable: false }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
type Fetch = (path: string, options?: { method?: string; body?: Required<MemoInput> & { baseVersion: string }; timeout?: number }) => Promise<Memo>

describe('자동저장과 최신 로컬 보관의 일관성', () => {
  let input: Required<MemoInput>
  let fetch: ReturnType<typeof vi.fn<Fetch>>
  let cleanup: Array<() => void>
  beforeEach(() => {
    vi.useFakeTimers()
    input = { title: original.title, content: original.content, date: null, dateEnd: null, tags: [] }
    cleanup = []
    const values = new Map<string, string>()
    const store: Storage = { get length() { return values.size }, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: key => { values.delete(key) }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null }
    const events = new EventTarget()
    fetch = vi.fn<Fetch>().mockResolvedValue({ ...original, version: 'v2' })
    vi.stubGlobal('localStorage', store)
    vi.stubGlobal('window', events)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('computed', computed)
    vi.stubGlobal('onBeforeUnmount', (fn: () => void) => { cleanup.push(fn) })
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('apiData', () => ({}))
    vi.stubGlobal('apiStatus', () => null)
    vi.stubGlobal('apiMessage', (_error: unknown, fallback: string) => fallback)
  })
  afterEach(() => { for (const fn of cleanup) fn(); vi.useRealTimers(); vi.unstubAllGlobals() })
  function setup() {
    return useMemoAutosave({ memo: original, read: () => ({ ...input, tags: [...input.tags] }), normalize: value => value, onSaved: vi.fn() })
  }
  it('첫 형식 검사 전과 승인되지 않은 형식 변경은 재전송 금지 초안으로 보관한다', async () => {
    const save = useMemoAutosave({ memo: original, read: () => ({ ...input }), normalize: () => '원문 형식 손실', onSaved: vi.fn() })
    input.content = '시각 편집 내용'; save.changed()
    expect(readDraft(original.id)?.review).toBe('pending')
    expect(await save.flush()).toBe(false)
    expect(save.state.value.status).toBe('format')
    expect(readDraft(original.id)?.review).toBe('format')
    expect(fetch).not.toHaveBeenCalled()
    expect(await save.acceptFormat()).toBe(true)
  })
  it.each([true, false])('첫 왕복 불일치에서 동등성 검사 결과(%s)에 따라 저장한다', async (equivalent) => {
    const memo = { ...original, content: '* 기존 항목' }
    const normalize = vi.fn(() => '- 기존 항목')
    const formatEquivalent = vi.fn(() => equivalent)
    const save = useMemoAutosave({ memo, read: () => ({ ...input }), normalize, formatEquivalent, onSaved: vi.fn() })
    input.content = '- 수정한 항목'
    save.changed()

    expect(await save.flush()).toBe(equivalent)
    expect(formatEquivalent).toHaveBeenCalledExactlyOnceWith(memo.content, '- 기존 항목')
    expect(save.state.value.status).toBe(equivalent ? 'saved' : 'format')
    expect(fetch).toHaveBeenCalledTimes(Number(equivalent))
    if (equivalent) {
      expect(fetch.mock.calls[0]?.[1]?.body?.content).toBe(input.content)
      input.content = '- 다시 수정한 항목'
      save.changed()
      expect(await save.flush()).toBe(true)
      expect(normalize).toHaveBeenCalledTimes(1)
    } else {
      expect(readDraft(memo.id)?.review).toBe('format')
    }
  })
  it('원문 편집으로 일시 중지하면 일반 보관이 원문 초안을 덮지 않는다', () => {
    const save = setup(); save.pause()
    const source = { id: original.id, baseVersion: 'v1', source: true, input: { ...input, content: '<div>원문</div>' }, savedAt: '2026-11-17T00:00:00Z' }
    writeDraft(source)
    save.preserveDraft(); save.changed()
    expect(readDraft(original.id)).toEqual(source)
  })
  it('재조회 중 다른 탭에서 추가한 초안을 삭제하지 않는다', async () => {
    const save = setup(); const pending = deferred<Memo>()
    fetch.mockReturnValueOnce(pending.promise)
    const reloading = save.reload()
    const latest = { id: original.id, baseVersion: 'v1', input: { ...input, content: '다른 탭' }, savedAt: '2026-11-17T00:00:00Z' }
    writeDraft(latest)
    pending.resolve({ ...original, version: 'v2' })
    await reloading
    expect(readDraft(original.id)).toEqual(latest)
  })
  it('충돌 덮어쓰기 승인 뒤 통신 실패가 나도 승인한 버전으로 재시도한다', async () => {
    vi.stubGlobal('apiStatus', (error: { statusCode?: number }) => error.statusCode ?? null)
    vi.stubGlobal('apiData', () => ({ version: 'v9' }))
    const save = setup()
    input.content = '수정'; save.changed()
    fetch.mockRejectedValueOnce({ statusCode: 409 }).mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ...original, version: 'v10' })
    expect(await save.flush()).toBe(false)
    expect(await save.overwrite()).toBe(false)
    expect(await save.save()).toBe(true)
    expect(fetch.mock.calls[2]?.[1]?.body?.baseVersion).toBe('v9')
  })
  it('debounce 이전에도 입력 내용을 보관한다', () => {
    const save = setup()
    input.content = '아직 요청하지 않은 입력'
    save.changed()
    expect(fetch).not.toHaveBeenCalled()
    expect(readDraft(original.id)?.input.content).toBe(input.content)
  })
  it('느린 저장 중 새 입력까지 저장한 뒤 flush가 완료된다', async () => {
    const save = setup()
    const first = deferred<Memo>()
    const second = deferred<Memo>()
    fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    input.content = '첫 입력'; save.changed()
    const waiting = save.flush()
    await Promise.resolve()
    input.content = '다음 입력'; save.changed()
    first.resolve({ ...original, content: '첫 입력', version: 'v2' })
    await vi.advanceTimersByTimeAsync(0)
    expect(readDraft(original.id)?.input.content).toBe('다음 입력')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1]?.[1]?.body?.baseVersion).toBe('v2')
    expect(save.state.value.status).not.toBe('saved')
    second.resolve({ ...original, content: '다음 입력', version: 'v3' })
    expect(await waiting).toBe(true)
    expect(save.state.value.status).toBe('saved')
    expect(readDraft(original.id)).toBeNull()
  })
  it('성공 응답은 다른 탭에서 더 최근에 쓴 보관 수정을 지우지 않는다', async () => {
    const save = setup()
    const pending = deferred<Memo>()
    fetch.mockReturnValueOnce(pending.promise)
    input.content = '요청한 입력'; save.changed()
    const saving = save.flush()
    await Promise.resolve()
    writeDraft({ id: original.id, baseVersion: 'v1', input: { ...input, content: '다른 탭의 새 입력' }, savedAt: '2026-11-17T00:00:01Z' })
    pending.resolve({ ...original, content: '요청한 입력', version: 'v2' })
    await saving
    expect(readDraft(original.id)?.input.content).toBe('다른 탭의 새 입력')
  })
  it('늦은 충돌 응답은 다른 탭의 보관 수정을 이전 입력으로 덮지 않는다', async () => {
    vi.stubGlobal('apiStatus', () => 409)
    vi.stubGlobal('apiData', () => ({ version: 'v9' }))
    const save = setup()
    const pending = deferred<Memo>()
    fetch.mockImplementationOnce(async () => { await pending.promise; throw new Error('conflict') })
    input.content = '이전 요청'; save.changed()
    const saving = save.flush()
    await Promise.resolve()
    const latest = { id: original.id, baseVersion: 'v1', input: { ...input, content: '다른 탭의 새 입력' }, savedAt: '2026-11-17T00:00:01Z' }
    writeDraft(latest)
    pending.resolve(original)
    expect(await saving).toBe(false)
    expect(save.state.value.status).toBe('conflict')
    expect(readDraft(original.id)).toEqual(latest)
  })
  it('동시에 누른 저장은 한 요청을 공유한다', async () => {
    const save = setup()
    const pending = deferred<Memo>()
    fetch.mockReturnValueOnce(pending.promise)
    input.content = '저장'; save.changed()
    const first = save.flush()
    const second = save.flush()
    await Promise.resolve()
    pending.resolve({ ...original, content: input.content, version: 'v2' })
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
