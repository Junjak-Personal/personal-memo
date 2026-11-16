import { describe, expect, it, vi } from 'vitest'
import { createMemoRefresh } from './memo-refresh'
import type { MemoRefreshState } from './memo-refresh'

function deferred() {
  let resolve!: (value: boolean) => void
  const promise = new Promise<boolean>(done => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  let scope: string | null = 'owner-session'
  let online = true
  let visible = true
  let time = 100_000
  let state: MemoRefreshState = { status: 'idle', refreshedAt: null }
  const active = vi.fn<(manual: boolean) => Promise<boolean>>().mockResolvedValue(true)
  const tree = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
  const controller = createMemoRefresh({ scope: () => scope, online: () => online, visible: () => visible, now: () => time, refreshActive: active, refreshTree: tree, setState: value => { state = value }, message: () => '통신 실패' })
  return { ...controller, active, tree, get state() { return state }, session: (next: string | null) => { scope = next; controller.reset() }, offline: () => { online = false }, hide: () => { visible = false }, advance: () => { time += 31_000 } }
}
describe('화면 새로고침과 복귀 동기화', () => {
  it('직접 갱신은 열린 메모 저장·조회 후 목록을 갱신한다', async () => {
    const f = fixture()
    expect(await f.refresh(true)).toBe(true)
    expect(f.active).toHaveBeenCalledWith(true)
    expect(f.tree.mock.invocationCallOrder[0]).toBeGreaterThan(f.active.mock.invocationCallOrder[0]!)
    expect(f.state).toEqual({ status: 'idle', refreshedAt: 100_000 })
  })
  it('현재 입력 저장에 실패하면 목록 갱신과 성공 표시를 하지 않는다', async () => {
    const f = fixture(); f.active.mockResolvedValue(false)
    expect(await f.refresh(true)).toBe(false)
    expect(f.tree).not.toHaveBeenCalled()
    expect(f.state.status).toBe('error')
  })
  it('복귀 이벤트는 진행 중 요청을 공유하고 짧은 간격의 재조회를 합친다', async () => {
    const f = fixture(); const pending = deferred(); f.tree.mockReturnValueOnce(pending.promise)
    const first = f.refresh(); const second = f.refresh()
    expect(first).toBe(second)
    pending.resolve(true); await first
    await f.refresh(); expect(f.tree).toHaveBeenCalledTimes(1)
    f.advance(); await f.refresh(); expect(f.tree).toHaveBeenCalledTimes(2)
  })
  it('진행 중 자동 확인 뒤 직접 새로고침은 저장을 포함해 별도로 실행한다', async () => {
    const f = fixture(); const pending = deferred(); f.tree.mockReturnValueOnce(pending.promise)
    const automatic = f.refresh(); const manual = f.refresh(true)
    pending.resolve(true); await Promise.all([automatic, manual])
    expect(f.active.mock.calls.map(([manual]) => manual)).toEqual([false, true])
  })
  it('숨은 화면·오프라인·로그아웃에서는 불필요한 조회를 시작하지 않는다', async () => {
    const f = fixture(); f.hide(); expect(await f.refresh()).toBe(false)
    f.offline(); expect(await f.refresh(true)).toBe(false); expect(f.state.status).toBe('offline')
    f.session(null); expect(await f.refresh(true)).toBe(false)
    expect(f.tree).not.toHaveBeenCalled(); expect(f.active).not.toHaveBeenCalled()
  })
  it('로그인 변경 뒤 오래된 완료는 갱신 시각이나 새 상태를 덮지 않는다', async () => {
    const f = fixture(); const pending = deferred(); f.tree.mockReturnValueOnce(pending.promise)
    const automatic = f.refresh(); await Promise.resolve(); await Promise.resolve()
    const manual = f.refresh(true); f.session('new-owner-session')
    pending.resolve(true); await Promise.all([automatic, manual])
    expect(f.state).toEqual({ status: 'idle', refreshedAt: null })
    expect(f.active).toHaveBeenCalledTimes(1)
  })
  it('실패는 성공 시각을 만들지 않고 다음 직접 요청으로 복구한다', async () => {
    const f = fixture(); f.tree.mockResolvedValueOnce(false)
    expect(await f.refresh(true)).toBe(false)
    expect(f.state.refreshedAt).toBeNull()
    expect(await f.refresh(true)).toBe(true)
    expect(f.state.status).toBe('idle')
  })
})
