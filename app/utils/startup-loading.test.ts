import { describe, expect, it, vi } from 'vitest'
import { createStartupGate, startupRequests } from './startup-loading'

const immediately = (ready: () => void) => (commit: () => boolean) => { if (commit()) ready() }

describe('첫 화면 준비 경계', () => {
  it('문서 수신이나 page finish만으로 닫지 않고 mount·tree·에디터를 모두 기다린다', () => {
    const ready = vi.fn()
    const gate = createStartupGate(immediately(ready))
    gate.pageReady('one', true)
    gate.mounted()
    gate.treeSettled()
    expect(ready).not.toHaveBeenCalled()
    gate.contentReady('one')
    expect(ready).toHaveBeenCalledTimes(1)
    gate.contentReady('one')
    gate.pagePending()
    gate.pageReady('two', true)
    expect(ready).toHaveBeenCalledTimes(1)
  })
  it('editor가 page finish보다 먼저 만들어져도 바로 완료하며 고정 지연을 넣지 않는다', () => {
    const ready = vi.fn()
    const gate = createStartupGate(immediately(ready))
    gate.mounted()
    gate.contentReady('one')
    gate.pageReady('one', false)
    expect(ready).toHaveBeenCalledOnce()
  })
  it('새 화면 대기 중 이전 메모 완료는 준비 완료로 처리하지 않는다', () => {
    const ready = vi.fn()
    const gate = createStartupGate(immediately(ready))
    gate.mounted()
    gate.pagePending()
    gate.contentReady('old')
    gate.pageReady('new', false)
    expect(ready).not.toHaveBeenCalled()
    gate.contentReady('new')
    expect(ready).toHaveBeenCalledOnce()
  })
  it('로그인/외부 화면은 tree 없이, 기존 API 오류 화면은 내용 완료 신호 뒤 표시한다', () => {
    const ready = vi.fn()
    const gate = createStartupGate(immediately(ready))
    gate.mounted()
    gate.pageReady(null, false)
    expect(ready).toHaveBeenCalledOnce()
    const failedMemo = createStartupGate(immediately(ready))
    failedMemo.mounted()
    failedMemo.pageReady('missing', true)
    failedMemo.contentReady('missing')
    failedMemo.treeSettled()
    expect(ready).toHaveBeenCalledTimes(2)
  })
  it('인증 변경은 tree 완료를 무효화하고 치명적 오류 뒤 ready를 보내지 않는다', () => {
    const ready = vi.fn()
    const gate = createStartupGate(immediately(ready))
    gate.treeSettled()
    gate.treePending()
    gate.mounted()
    gate.pageReady(null, true)
    expect(ready).not.toHaveBeenCalled()
    gate.stop()
    gate.treeSettled()
    expect(ready).not.toHaveBeenCalled()
  })
  it('다음 paint 전 화면이나 세션이 바뀌면 예정된 완료를 취소하고 새 준비를 기다린다', () => {
    let commit = () => false
    const gate = createStartupGate((accept) => { commit = accept })
    gate.mounted()
    gate.treeSettled()
    gate.pageReady(null, true)
    gate.pagePending()
    expect(commit()).toBe(false)
    gate.pageReady('new', true)
    gate.contentReady('new')
    gate.treePending()
    expect(commit()).toBe(false)
    gate.treeSettled()
    expect(commit()).toBe(true)
    expect(commit()).toBe(false)
  })
})

it('초기 요청 수·시간만 집계하고 URL/메모/계정 정보를 결과에 남기지 않는다', () => {
  const result = startupRequests([
    { name: 'https://memo.test/api/_auth/session', duration: 30.4 },
    { name: 'https://memo.test/api/tree', duration: 10.2 },
    { name: 'https://memo.test/api/memos/private-id', duration: 20.6 },
    { name: 'https://other.test/api/tree', duration: 999 },
    { name: 'https://memo.test/api/calendar', duration: 999 },
    { name: 'not a url', duration: 999 },
  ], 'https://memo.test')
  expect(result).toEqual({ sessionRequests: 1, treeRequests: 1, memoRequests: 1, sessionMs: 30, treeMs: 10, memoMs: 21 })
  expect(JSON.stringify(result)).not.toMatch(/private|https|account/)
})
