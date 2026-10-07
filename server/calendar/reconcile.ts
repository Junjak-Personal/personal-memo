/**
 * 대조 — 메모 인덱스와 「메모」 캘린더의 일정을 memoId 로 맞춰 할 일을 정한다 (설계문서 §8.3).
 * 순수 함수다. 실제 호출은 sync.ts 가 한다.
 *
 * | 인덱스                         | 캘린더              | 동작        |
 * | date 있음                      | 없음                | 생성        |
 * | 제목·date·date_end 가 다름     | 있음                | 수정        |
 * | date 없음, 휴지통, 파일 사라짐 | 있음                | 삭제        |
 * | —                              | memoId 없는 일정    | 손대지 않음 |
 */
import type { HeldDeletes } from '../../shared/types/calendar-sync'
import type { MemoMeta } from '../../shared/types/memo'
import { addDays } from '../../shared/utils/memo-date'
import type { EventWrite, GoogleEvent } from './google'

/**
 * 🔴 대량 삭제 차단. 한 번에 이 수 이하는 늘 지운다 — 일정이 한두 개뿐일 때는 하나만 지워도 「절반 초과」라,
 *    문턱이 없으면 날짜 하나 지우는 평범한 일까지 막힌다. 이보다 많고 기존의 절반을 넘으면 미룬다.
 */
export const MASS_DELETE_FREE = 3

export type SyncMemo = Pick<MemoMeta, 'id' | 'title' | 'dateEnd'> & { date: string }

export type SyncOp =
  | { kind: 'create'; memoId: string; body: EventWrite }
  | { kind: 'update'; memoId: string; eventId: string; body: EventWrite }
  /** orphan — 메모가 없거나 날짜가 지워짐, duplicate — 같은 memoId 의 두 번째 일정 */
  | { kind: 'delete'; memoId: string; eventId: string; reason: 'orphan' | 'duplicate' }

export interface SyncPlan {
  ops: SyncOp[]
  /** 미뤄 둔 삭제. 있으면 ops 에 orphan 삭제가 들어 있지 않다 */
  held: HeldDeletes | null
}

/** 일정과 메모를 견줄 때 쓰는 모양. dateEnd 는 끝 날짜 «포함», 하루짜리는 null */
export interface EventShape {
  title: string
  date: string | null
  dateEnd: string | null
}

export function memoIdOf(event: GoogleEvent) {
  return event.extendedProperties?.private?.memoId ?? null
}

export function shapeOfMemo(memo: SyncMemo): EventShape {
  return { title: memo.title, date: memo.date, dateEnd: memo.dateEnd && memo.dateEnd !== memo.date ? memo.dateEnd : null }
}

/** 🔴 종일 일정의 end.date 는 끝 날짜를 포함하지 않는다 — 하루 빼서 메모 쪽 표기로 맞춘다 */
export function shapeOfEvent(event: GoogleEvent): EventShape {
  // 시간 일정(dateTime)으로 바뀐 것은 날짜가 없는 것으로 본다 — 다르다고 판정돼 종일로 되돌린다
  const date = event.start?.date ?? null
  const end = event.end?.date ? addDays(event.end.date, -1) : null
  return { title: event.summary ?? '', date, dateEnd: date && end && end > date ? end : null }
}

export function sameShape(a: EventShape | null, b: EventShape | null) {
  if (!a || !b) return a === b
  return a.title === b.title && a.date === b.date && a.dateEnd === b.dateEnd
}

/** 메모 주소. siteUrl 이 없으면(개발) 비운다 */
export function memoUrl(siteUrl: string, memoId: string) {
  return siteUrl ? `${siteUrl.replace(/\/+$/, '')}/m/${memoId}` : ''
}

/** 새로 만들 일정 */
export function eventForInsert(memo: SyncMemo, siteUrl: string): EventWrite {
  return {
    summary: memo.title,
    description: memoUrl(siteUrl, memo.id),
    start: { date: memo.date },
    end: { date: addDays(memo.dateEnd ?? memo.date, 1) },
    // 메모 일정 때문에 「바쁨」으로 보이지 않게 한다 (구글 화면에서 만든 종일 일정의 기본값과 같다)
    transparency: 'transparent',
    extendedProperties: { private: { memoId: memo.id } },
  }
}

/**
 * 고칠 때 보내는 부분. PATCH 는 start·end 객체를 «합치므로», 구글 화면에서 시간 일정으로 바꿨다면
 * dateTime 을 null 로 지워야 종일로 돌아간다. 색·알림처럼 사람이 구글에서 붙인 것은 건드리지 않는다.
 */
export function eventForPatch(memo: SyncMemo, siteUrl: string): EventWrite {
  return {
    summary: memo.title,
    description: memoUrl(siteUrl, memo.id),
    start: { date: memo.date, dateTime: null, timeZone: null },
    end: { date: addDays(memo.dateEnd ?? memo.date, 1), dateTime: null, timeZone: null },
  }
}

interface PlanInput {
  memos: SyncMemo[]
  /** 메모 파일 수 (날짜 없는 것·휴지통 포함). 0 이면 데이터 폴더가 빠진 것으로 본다 */
  total: number
  events: GoogleEvent[]
  siteUrl: string
  /** 사람이 화면에서 「그래도 지우기」를 눌렀다 */
  allowMassDelete?: boolean
}

export function planSync({ memos, total, events, siteUrl, allowMassDelete = false }: PlanInput): SyncPlan {
  const byMemo = new Map<string, GoogleEvent[]>()
  for (const event of events) {
    const memoId = memoIdOf(event)
    if (!memoId) continue
    byMemo.set(memoId, [...(byMemo.get(memoId) ?? []), event])
  }

  const ops: SyncOp[] = []
  const wanted = new Map(memos.map((m) => [m.id, m]))

  for (const memo of memos) {
    const linked = byMemo.get(memo.id) ?? []
    const want = shapeOfMemo(memo)
    if (!linked.length) {
      ops.push({ kind: 'create', memoId: memo.id, body: eventForInsert(memo, siteUrl) })
      continue
    }
    // 같은 메모의 일정이 둘 이상이면(생성 응답을 놓친 재시도 등) 이미 맞는 것을 남기고 나머지를 지운다
    const keep = linked.find((e) => sameShape(shapeOfEvent(e), want)) ?? linked[0]!
    if (!sameShape(shapeOfEvent(keep), want)) {
      ops.push({ kind: 'update', memoId: memo.id, eventId: keep.id, body: eventForPatch(memo, siteUrl) })
    }
    for (const extra of linked) {
      if (extra !== keep) ops.push({ kind: 'delete', memoId: memo.id, eventId: extra.id, reason: 'duplicate' })
    }
  }

  const orphans: SyncOp[] = []
  for (const [memoId, linked] of byMemo) {
    if (wanted.has(memoId)) continue
    for (const event of linked) orphans.push({ kind: 'delete', memoId, eventId: event.id, reason: 'orphan' })
  }

  const existing = byMemo.size
  const deletes = orphans.length
  const held: HeldDeletes | null =
    allowMassDelete || deletes === 0
      ? null
      : total === 0
        ? { reason: 'empty', deletes, existing }
        : deletes > MASS_DELETE_FREE && deletes > existing / 2
          ? { reason: 'many', deletes, existing }
          : null

  return { ops: held ? ops : [...ops, ...orphans], held }
}
