import { describe, expect, it } from 'vitest'
import { addDays, isDateString, kstDay, nowKst, weekdayOf } from './memo-date'

describe('memo-date', () => {
  it('addDays 는 달·해·윤년을 넘는다', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('weekdayOf 는 시간대와 무관하다', () => {
    expect(weekdayOf('2026-10-04')).toBe(0)
    expect(weekdayOf('2026-10-10')).toBe(6)
  })

  it('kstDay 는 UTC 저녁을 KST 다음 날로 본다', () => {
    expect(kstDay('2026-10-06T15:30:00Z')).toBe('2026-10-07')
    expect(kstDay('2026-10-07T08:00:00+09:00')).toBe('2026-10-07')
    expect(kstDay('nope')).toBeNull()
  })

  it('nowKst 는 +09:00 꼴이다', () => {
    expect(nowKst(new Date('2026-10-06T15:30:00Z'))).toBe('2026-10-07T00:30:00+09:00')
  })

  it('isDateString 은 없는 날을 거부한다', () => {
    expect(isDateString('2026-02-30')).toBe(false)
    expect(isDateString('2026-02-28')).toBe(true)
  })
})
