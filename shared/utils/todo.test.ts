import { describe, expect, it } from 'vitest'
import { compareDoneTodos, isScheduled } from './todo'

describe('isScheduled — 캘린더에 일정으로 보이는가', () => {
  it('날짜가 있고 끝나지 않은 것만', () => {
    expect(isScheduled({ date: '2026-10-15', done: null })).toBe(true)
    expect(isScheduled({ date: '2026-10-15', done: false })).toBe(true)
    expect(isScheduled({ date: '2026-10-15', done: true })).toBe(false)
    expect(isScheduled({ date: null, done: false })).toBe(false)
    expect(isScheduled({ date: null, done: null })).toBe(false)
  })
})

describe('compareDoneTodos — 완료 목록 순서', () => {
  it('날짜(없으면 만든 날)가 최근인 것부터', () => {
    const list = [
      { title: '옛 일정', date: '2026-10-01', created: '2026-09-20T09:00:00+09:00' },
      { title: '날짜 없음-최근', date: null, created: '2026-10-15T09:00:00+09:00' },
      { title: '20일', date: '2026-10-20', created: '2026-10-02T09:00:00+09:00' },
      { title: '날짜 없음-옛날', date: null, created: '2026-09-01T09:00:00+09:00' },
    ]
    expect(list.sort(compareDoneTodos).map((t) => t.title)).toEqual(['20일', '날짜 없음-최근', '옛 일정', '날짜 없음-옛날'])
  })
})
