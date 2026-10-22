import { describe, expect, it, vi } from 'vitest'
import type { TreeResponse } from '#shared/types/memo'
import { createSessionTree } from './session-tree'

function tree(id: string): TreeResponse {
  return { folders: [{ path: id, name: id, children: [] }], memos: [], orders: {} }
}

function deferred() {
  let resolve!: (value: TreeResponse) => void
  let reject!: (error: Error) => void
  const promise = new Promise<TreeResponse>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function fixture() {
  let scope: string | null = 'one'
  let value: TreeResponse | null = null
  let error: string | null = null
  const fetch = vi.fn<() => Promise<TreeResponse>>()
  const shared = createSessionTree({
    scope: () => scope,
    tree: () => value,
    setTree: (next) => { value = next },
    setError: (next) => { error = next },
    fetch,
    message: () => '목록 오류',
  })
  return {
    ...shared, fetch,
    get tree() { return value },
    get error() { return error },
    switch(next: string | null) { scope = next; shared.syncScope() },
  }
}

describe('세션 안에서 공유하는 첫 목록 조회', () => {
  it('동시에 기다리는 복원·사이드바·태그는 한 요청을 나누고 성공 결과도 재사용한다', async () => {
    const state = fixture()
    const load = deferred()
    state.fetch.mockReturnValue(load.promise)
    const first = state.ensure()
    expect(state.ensure()).toBe(first)
    await Promise.resolve()
    expect(state.fetch).toHaveBeenCalledTimes(1)
    load.resolve(tree('one'))
    expect(await first).toBe(state.tree)
    expect(await state.ensure()).toBe(state.tree)
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })

  it('settled도 첫 요청을 공유하고 완료 뒤에는 추가 조회를 시작하지 않는다', async () => {
    const state = fixture()
    const load = deferred()
    state.fetch.mockReturnValue(load.promise)
    const waiting = state.settled()
    const initial = state.ensure()
    expect(state.ensure()).toBe(initial)
    await Promise.resolve()
    expect(state.fetch).toHaveBeenCalledTimes(1)
    load.resolve(tree('initial'))
    expect(await waiting).toEqual(tree('initial'))
    expect(await state.settled()).toEqual(tree('initial'))
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })

  it('settled는 이전 ensure 실패를 완료로 취급하지 않고 새 갱신이 끝날 때까지 기다린다', async () => {
    const state = fixture()
    const old = deferred()
    const fresh = deferred()
    state.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const initial = state.ensure()
    const rejected = expect(initial).rejects.toThrow('갱신이 바뀌었습니다')
    const completed = vi.fn()
    const waiting = state.settled().then((tree) => { completed(); return tree })
    await Promise.resolve()
    const refresh = state.refresh()
    await Promise.resolve()
    old.resolve(tree('old'))
    await rejected
    expect(completed).not.toHaveBeenCalled()
    fresh.resolve(tree('fresh'))
    expect(await waiting).toEqual(tree('fresh'))
    await refresh
    expect(state.fetch).toHaveBeenCalledTimes(2)
  })

  it('settled는 오래 걸리는 이전 응답을 기다리지 않고 최신 갱신 결과로 완료한다', async () => {
    const state = fixture()
    const old = deferred()
    const fresh = deferred()
    state.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const initial = state.ensure()
    const rejected = expect(initial).rejects.toThrow()
    const waiting = state.settled()
    await Promise.resolve()
    const refresh = state.refresh()
    await Promise.resolve()
    fresh.resolve(tree('fresh'))
    expect(await waiting).toEqual(tree('fresh'))
    await refresh
    old.resolve(tree('old'))
    await rejected
    expect(state.tree).toEqual(tree('fresh'))
  })

  it('settled는 최신 실패를 반환하고 다시 호출해도 실패 뒤 재시도를 만들지 않는다', async () => {
    const state = fixture()
    const old = deferred()
    const fresh = deferred()
    state.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const initial = state.ensure()
    const rejectedInitial = expect(initial).rejects.toThrow()
    const rejectedWaiting = expect(state.settled()).rejects.toThrow('latest failure')
    await Promise.resolve()
    const refresh = state.refresh()
    await Promise.resolve()
    fresh.reject(new Error('latest failure'))
    await Promise.all([refresh, rejectedWaiting])
    await expect(state.settled()).rejects.toThrow('latest failure')
    expect(state.fetch).toHaveBeenCalledTimes(2)
    old.resolve(tree('old'))
    await rejectedInitial
    expect(state.tree).toBeNull()
  })

  it('첫 조회 실패 뒤 시작한 settled도 오류를 그대로 반환한다', async () => {
    const state = fixture()
    state.fetch.mockRejectedValue(new Error('first failure'))
    await expect(state.ensure()).rejects.toThrow('first failure')
    await expect(state.settled()).rejects.toThrow('first failure')
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })

  it('settled는 세션 변경 시 이전 응답을 기다리거나 새 세션 결과를 사용하지 않는다', async () => {
    const state = fixture()
    const old = deferred()
    state.fetch.mockReturnValueOnce(old.promise)
    const initial = state.ensure()
    const rejectedInitial = expect(initial).rejects.toThrow()
    const rejectedWaiting = expect(state.settled()).rejects.toThrow()
    await Promise.resolve()
    state.switch(null)
    state.switch('one')
    await rejectedWaiting
    expect(state.fetch).toHaveBeenCalledTimes(1)
    state.fetch.mockResolvedValueOnce(tree('new-session'))
    expect(await state.settled()).toEqual(tree('new-session'))
    old.resolve(tree('old-session'))
    await rejectedInitial
    expect(state.tree).toEqual(tree('new-session'))
  })

  it('명시적 갱신은 이전 요청과 분리되고 늦은 이전 결과가 새 결과를 덮지 않는다', async () => {
    const state = fixture()
    const old = deferred()
    const fresh = deferred()
    state.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const initial = state.ensure()
    const rejected = expect(initial).rejects.toThrow('갱신이 바뀌었습니다')
    await Promise.resolve()
    const refresh = state.refresh()
    const joined = state.ensure()
    await Promise.resolve()
    expect(state.fetch).toHaveBeenCalledTimes(2)
    fresh.resolve(tree('after-save'))
    await refresh
    expect(await joined).toEqual(tree('after-save'))
    old.resolve(tree('before-save'))
    await rejected
    expect(state.tree).toEqual(tree('after-save'))
    expect(await state.ensure()).toEqual(tree('after-save'))
  })

  it('겹친 명시적 갱신 중 마지막 요청만 결과와 오류를 바꾼다', async () => {
    const state = fixture()
    const old = deferred()
    const fresh = deferred()
    state.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const previous = state.refresh()
    await Promise.resolve()
    const latest = state.refresh()
    await Promise.resolve()
    fresh.resolve(tree('latest'))
    await latest
    old.reject(new Error('old failure'))
    await previous
    expect(state.tree).toEqual(tree('latest'))
    expect(state.error).toBeNull()
  })

  it('세션이 바뀌면 즉시 목록·오류를 지우고 이전 응답은 복원 검증에도 쓸 수 없다', async () => {
    const state = fixture()
    state.fetch.mockResolvedValueOnce(tree('private-one'))
    await state.ensure()
    const old = deferred()
    state.fetch.mockReturnValueOnce(old.promise)
    const refresh = state.refresh()
    const oldEnsure = state.ensure()
    const rejected = expect(oldEnsure).rejects.toThrow()
    await Promise.resolve()
    state.switch('two')
    expect(state.tree).toBeNull()
    expect(state.error).toBeNull()
    state.fetch.mockResolvedValueOnce(tree('private-two'))
    expect(await state.ensure()).toEqual(tree('private-two'))
    old.resolve(tree('private-one'))
    await Promise.all([refresh, rejected])
    expect(state.tree).toEqual(tree('private-two'))
  })

  it('로그아웃과 재로그인 사이에 세션 값이 돌아와도 이전 요청은 유효해지지 않는다', async () => {
    const state = fixture()
    const old = deferred()
    state.fetch.mockReturnValueOnce(old.promise)
    const initial = state.ensure()
    const rejected = expect(initial).rejects.toThrow()
    await Promise.resolve()
    state.switch(null)
    await expect(state.ensure()).rejects.toThrow()
    expect(state.fetch).toHaveBeenCalledTimes(1)
    state.switch('one')
    state.fetch.mockResolvedValueOnce(tree('new-login'))
    await state.ensure()
    old.resolve(tree('old-login'))
    await rejected
    expect(state.tree).toEqual(tree('new-login'))
  })

  it('실패를 캐시하지 않고 다음 ensure에서 재시도하며 로그아웃 때 오류도 지운다', async () => {
    const state = fixture()
    state.fetch.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(tree('retried'))
    await expect(state.ensure()).rejects.toThrow('network')
    expect(state.error).toBe('목록 오류')
    expect(await state.ensure()).toEqual(tree('retried'))
    expect(state.error).toBeNull()
    expect(state.fetch).toHaveBeenCalledTimes(2)
    state.fetch.mockRejectedValueOnce(new Error('403'))
    await expect(state.refresh()).resolves.toBeUndefined()
    expect(state.error).toBe('목록 오류')
    state.switch(null)
    expect(state.tree).toBeNull()
    expect(state.error).toBeNull()
  })

  it('갱신 실패 후 남은 표시용 목록으로 복원을 허용하지 않는다', async () => {
    const state = fixture()
    state.fetch.mockResolvedValueOnce(tree('old')).mockRejectedValue(new Error('403'))
    await state.ensure()
    await state.refresh()
    expect(state.tree).toEqual(tree('old'))
    await expect(state.ensure()).rejects.toThrow('403')
    expect(state.fetch).toHaveBeenCalledTimes(3)
  })

  it('새 앱 인스턴스는 같은 로그인이어도 이전 앱 결과를 재사용하지 않는다', async () => {
    const first = fixture()
    first.fetch.mockResolvedValue(tree('before-restart'))
    await first.ensure()
    const next = fixture()
    next.fetch.mockResolvedValue(tree('after-restart'))
    expect(await next.ensure()).toEqual(tree('after-restart'))
    expect(next.fetch).toHaveBeenCalledTimes(1)
  })
})
