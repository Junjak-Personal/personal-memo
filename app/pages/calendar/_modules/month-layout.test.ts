import { describe, expect, it } from 'vitest'
import type { MemoMeta } from '#shared/types/memo'
import { groupByCreatedDay, layoutWeek, MAX_LANES, monthWeeks, scheduledOn, shiftMonth } from './month-layout'

function memo(id: string, date: string | null, dateEnd: string | null = null, created: string | null = null): MemoMeta {
  return { id, path: `${id}.md`, folder: '', title: id, created, updated: null, date, dateEnd, tags: [], done: null, priority: 'medium', public: false, unreadable: false }
}

// 2026-10: 1일이 목요일, 31일이 토요일
const OCT = monthWeeks('2026-10')

describe('monthWeeks', () => {
  it('일요일에 시작해 앞뒤 달 날짜로 주를 채운다', () => {
    expect(OCT).toHaveLength(5)
    expect(OCT[0]![0]).toBe('2026-09-27')
    expect(OCT[0]![4]).toBe('2026-10-01')
    expect(OCT.at(-1)!.at(-1)).toBe('2026-10-31')
  })

  it('1일이 일요일이면 앞 달 날짜가 없다 (2026-11)', () => {
    expect(monthWeeks('2026-11')[0]![0]).toBe('2026-11-01')
  })

  it('shiftMonth 는 해를 넘는다', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-10', -13)).toBe('2025-09')
  })
})

describe('layoutWeek', () => {
  const week = OCT[3]! // 10-18(일) ~ 10-24(토)

  it('하루짜리는 한 칸, 기간은 그 주 안에서 잘라 칸을 걸친다', () => {
    const { bars } = layoutWeek(week, [memo('one', '2026-10-20'), memo('span', '2026-10-15', '2026-10-19'), memo('next', '2026-10-23', '2026-10-27')])
    const by = Object.fromEntries(bars.map((b) => [b.memo.id, b]))
    expect(by.one).toMatchObject({ colStart: 2, colSpan: 1, continuesBefore: false, continuesAfter: false })
    expect(by.span).toMatchObject({ colStart: 0, colSpan: 2, continuesBefore: true, continuesAfter: false })
    expect(by.next).toMatchObject({ colStart: 5, colSpan: 2, continuesBefore: false, continuesAfter: true })
  })

  it('겹치지 않으면 같은 줄을 나눠 쓴다', () => {
    const { bars } = layoutWeek(week, [memo('a', '2026-10-18', '2026-10-19'), memo('b', '2026-10-20', '2026-10-21')])
    expect(bars.map((b) => b.lane)).toEqual([0, 0])
  })

  it(`${MAX_LANES}줄을 넘는 막대는 그리지 않고 날마다 수를 센다`, () => {
    const memos = Array.from({ length: MAX_LANES + 2 }, (_, i) => memo(`m${i}`, '2026-10-20', i === 0 ? '2026-10-21' : null))
    const { bars, hidden } = layoutWeek(week, memos)
    expect(bars).toHaveLength(MAX_LANES)
    expect(hidden).toEqual([0, 0, 2, 0, 0, 0, 0])
  })

  it('이 주에 안 걸치는 것과 날짜 없는 것은 뺀다', () => {
    expect(layoutWeek(week, [memo('x', '2026-10-25'), memo('y', null)]).bars).toEqual([])
  })
})

describe('groupByCreatedDay · scheduledOn', () => {
  it('만든 날은 KST 기준이다', () => {
    const days = groupByCreatedDay([memo('late', null, null, '2026-10-06T15:30:00Z'), memo('kst', null, null, '2026-10-07T08:00:00+09:00')])
    expect(days.get('2026-10-07')?.map((m) => m.id)).toEqual(['late', 'kst'])
  })

  it('그날에 걸친 일정 — 끝 날짜 포함', () => {
    const memos = [memo('a', '2026-10-20', '2026-10-22'), memo('b', '2026-10-22'), memo('c', '2026-10-23')]
    expect(scheduledOn('2026-10-22', memos).map((m) => m.id)).toEqual(['a', 'b'])
  })
})
