import { describe, expect, it } from 'vitest'
import { beginMenuNavigation, duplicateMenuNavigation, failMenuNavigation, finishMenuNavigation, initialMenuNavigation, setMenuOpen } from './mobile-menu-navigation'

const calendar = { path: '/calendar', memoId: null }
const todo = { path: '/todo', memoId: null }
const memo = { path: '/m/B', memoId: 'B' }
const opened = () => setMenuOpen(initialMenuNavigation(), true)

describe('모바일 메뉴에서 화면 이동', () => {
  it('목적 화면을 준비하는 동안 메뉴를 유지하고 준비되면 닫는다', () => {
    const state = beginMenuNavigation(opened(), calendar)
    expect(state.open).toBe(true)
    expect(finishMenuNavigation(state, calendar, state.sequence).open).toBe(false)
  })

  it('새 메모는 페이지 완료만으로 닫지 않고 해당 메모 준비를 기다린다', () => {
    const state = beginMenuNavigation(opened(), memo)
    expect(finishMenuNavigation(state, { ...memo, memoId: null }, state.sequence)).toBe(state)
    expect(finishMenuNavigation(state, { ...memo, memoId: 'A' }, state.sequence)).toBe(state)
    expect(finishMenuNavigation(state, memo, state.sequence).open).toBe(false)
  })

  it('빠르게 다른 메뉴를 누르면 이전 화면 완료와 취소가 최신 이동을 닫지 않는다', () => {
    const first = beginMenuNavigation(opened(), calendar)
    const latest = beginMenuNavigation(first, todo)
    expect(finishMenuNavigation(latest, calendar, first.sequence)).toBe(latest)
    expect(failMenuNavigation(latest, calendar.path, first.sequence)).toBe(latest)
    expect(failMenuNavigation(latest, calendar.path)).toBe(latest)
    expect(finishMenuNavigation(latest, todo, latest.sequence).open).toBe(false)
  })

  it('같은 목적지로 되돌아와도 첫 요청의 늦은 완료를 무시한다', () => {
    const first = beginMenuNavigation(opened(), calendar)
    const latest = beginMenuNavigation(beginMenuNavigation(first, todo), calendar)
    expect(finishMenuNavigation(latest, calendar, first.sequence)).toBe(latest)
    expect(finishMenuNavigation(latest, calendar, latest.sequence).open).toBe(false)
  })

  it('사용자가 닫았다 다시 연 메뉴는 이전 완료가 닫지 않는다', () => {
    const state = beginMenuNavigation(opened(), calendar)
    const reopened = setMenuOpen(setMenuOpen(state, false), true)
    expect(finishMenuNavigation(reopened, calendar, state.sequence)).toBe(reopened)
  })

  it('저장 가드가 막은 이동은 메뉴를 닫아 원래 문서와 오류를 드러낸다', () => {
    const state = beginMenuNavigation(opened(), calendar)
    const failed = failMenuNavigation(state, calendar.path)
    expect(failed.open).toBe(false)
    expect(failed.pending).toBeNull()
  })

  it('같은 화면을 다시 선택해도 메뉴를 닫는다', () => {
    expect(duplicateMenuNavigation(opened(), '/m/A').open).toBe(false)
  })

  it('느린 B 이동 중 현재 A를 다시 선택하면 B 대기를 취소하고 메뉴를 닫는다', () => {
    const state = beginMenuNavigation(opened(), memo)
    const repeated = duplicateMenuNavigation(state, '/m/A')
    expect(repeated.open).toBe(false)
    expect(repeated.pending).toBeNull()
    expect(finishMenuNavigation(repeated, memo, state.sequence)).toBe(repeated)
  })

  it('주소가 바뀌었어도 B 문서가 준비 중이면 B 중복 선택은 준비를 기다린다', () => {
    const state = beginMenuNavigation(opened(), memo)
    expect(duplicateMenuNavigation(state, memo.path)).toBe(state)
    expect(finishMenuNavigation(state, memo, state.sequence).open).toBe(false)
  })

  it('닫힌 메뉴의 일반 탐색은 별도 이동 상태를 만들지 않는다', () => {
    const state = initialMenuNavigation()
    expect(beginMenuNavigation(state, calendar)).toBe(state)
  })
})
