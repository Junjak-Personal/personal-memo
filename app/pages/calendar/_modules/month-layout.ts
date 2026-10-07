/**
 * 월 보기 배치 (설계문서 §8.4). 날짜는 전부 `YYYY-MM-DD` 문자열로 다룬다 — JS Date 로 바꾸면 UTC 로 읽혀
 * KST 에서 하루 밀린다. 주는 일요일에 시작한다.
 *
 * 일정 막대 배치는 nuxt-ui-templates/calendar 의 layoutAllDay(욕심쟁이 레인 채우기)를 따른다.
 */
import type { MemoMeta } from '#shared/types/memo'
import { addDays, kstDay, weekdayOf } from '#shared/utils/memo-date'

/** 한 주에 보이는 막대 줄 수. 넘치면 그 날 칸에 「+N」 */
export const MAX_LANES = 3

export interface WeekBar {
  memo: MemoMeta
  /** 0 = 일요일 */
  colStart: number
  colSpan: number
  lane: number
  /** 지난주에서 이어진다 — 왼쪽 모서리를 둥글리지 않는다 */
  continuesBefore: boolean
  continuesAfter: boolean
}

export interface WeekLayout {
  days: string[]
  /** MAX_LANES 안에 들어간 막대 */
  bars: WeekBar[]
  /** 날마다 못 그린 막대 수 */
  hidden: number[]
}

/** `2026-10` → 그 달을 덮는 주들 (일요일 시작, 앞뒤 달 날짜 포함) */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1)
  const start = addDays(first, -weekdayOf(first))
  const end = addDays(last, 6 - weekdayOf(last))
  const weeks: string[][] = []
  for (let day = start; day <= end; day = addDays(day, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)))
  }
  return weeks
}

/** `2026-10` 에서 delta 달 */
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const index = y * 12 + (m - 1) + delta
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

export function isMonthString(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

/** 메모의 마지막 날 (포함) */
export function lastDayOf(memo: MemoMeta) {
  return memo.dateEnd ?? memo.date
}

/** 한 주의 일정 막대. 시작이 이른 것, 같으면 긴 것부터 위 줄을 차지한다 */
export function layoutWeek(days: string[], memos: MemoMeta[]): WeekLayout {
  const first = days[0]!
  const last = days[days.length - 1]!
  const items = memos
    .flatMap((memo) => {
      const end = lastDayOf(memo)
      if (!memo.date || !end || memo.date > last || end < first) return []
      const colStart = memo.date < first ? 0 : days.indexOf(memo.date)
      const colEnd = end > last ? days.length - 1 : days.indexOf(end)
      return [{ memo, colStart, colSpan: colEnd - colStart + 1, continuesBefore: memo.date < first, continuesAfter: end > last }]
    })
    .sort(
      (a, b) =>
        a.colStart - b.colStart ||
        b.colSpan - a.colSpan ||
        a.memo.date!.localeCompare(b.memo.date!) ||
        a.memo.title.localeCompare(b.memo.title, 'ko') ||
        a.memo.id.localeCompare(b.memo.id),
    )

  const lanes: number[] = []
  const placed = items.map((item) => {
    let lane = lanes.findIndex((end) => end <= item.colStart)
    if (lane === -1) lane = lanes.length
    lanes[lane] = item.colStart + item.colSpan
    return { ...item, lane }
  })

  const hidden = days.map((_, col) => placed.filter((b) => b.lane >= MAX_LANES && col >= b.colStart && col < b.colStart + b.colSpan).length)
  return { days, bars: placed.filter((b) => b.lane < MAX_LANES), hidden }
}

/** 만든 날(KST) → 메모들 */
export function groupByCreatedDay(memos: MemoMeta[]) {
  const out = new Map<string, MemoMeta[]>()
  for (const memo of memos) {
    const day = memo.created ? kstDay(memo.created) : null
    if (!day) continue
    out.set(day, [...(out.get(day) ?? []), memo])
  }
  return out
}

/** 그날에 걸친 일정 */
export function scheduledOn(day: string, memos: MemoMeta[]) {
  return memos.filter((m) => m.date && m.date <= day && (lastDayOf(m) ?? m.date) >= day)
}
