import { describe, expect, it } from 'vitest'
import { compareDoneTodos, compareTodos, isScheduled } from './todo'

describe('isScheduled — 캘린더에 일정으로 보이는가', () => {
  it('날짜가 있고 끝나지 않은 것만', () => {
    expect(isScheduled({ date: '2026-10-15', done: null })).toBe(true)
    expect(isScheduled({ date: '2026-10-15', done: false })).toBe(true)
    expect(isScheduled({ date: '2026-10-15', done: true })).toBe(false)
    expect(isScheduled({ date: null, done: false })).toBe(false)
    expect(isScheduled({ date: null, done: null })).toBe(false)
  })
})

describe('compareTodos — 할 일 목록 순서', () => {
  const todo = (title: string, date: string | null, created: string | null) => ({ title, date, created })

  it('날짜 있는 것이 먼저(가까운 날부터), 날짜 없는 것은 최근에 만든 것부터', () => {
    const list = [
      todo('없음-옛날', null, '2026-10-01T09:00:00+09:00'),
      todo('20일', '2026-10-20', '2026-10-02T09:00:00+09:00'),
      todo('없음-최근', null, '2026-10-07T09:00:00+09:00'),
      todo('9일', '2026-10-09', '2026-10-05T09:00:00+09:00'),
      todo('없음-생성시각없음', null, null),
    ]
    expect(list.sort(compareTodos).map((t) => t.title)).toEqual(['9일', '20일', '없음-최근', '없음-옛날', '없음-생성시각없음'])
  })

  it('같은 날짜면 제목 순', () => {
    const list = [todo('나', '2026-10-09', null), todo('가', '2026-10-09', null)]
    expect(list.sort(compareTodos).map((t) => t.title)).toEqual(['가', '나'])
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
