import { describe, expect, it } from 'vitest'
import type { GoogleEvent } from './google'
import { MASS_DELETE_FREE, planSync, type SyncMemo } from './reconcile'

const SITE = 'https://memo.example.com'

function memo(id: string, date: string, dateEnd: string | null = null, title = `메모 ${id}`): SyncMemo {
  return { id, title, date, dateEnd }
}

function event(id: string, memoId: string | null, start: string, endExclusive: string, summary = `메모 ${memoId}`): GoogleEvent {
  return {
    id,
    summary,
    start: { date: start },
    end: { date: endExclusive },
    ...(memoId ? { extendedProperties: { private: { memoId } } } : {}),
  }
}

describe('planSync', () => {
  it('날짜 있는 메모에 일정이 없으면 만든다 — 끝 날짜 +1, 설명에 메모 주소, 한가함', () => {
    const { ops, held } = planSync({ memos: [memo('A', '2026-10-20', '2026-10-22')], total: 1, events: [], siteUrl: SITE })
    expect(held).toBeNull()
    expect(ops).toEqual([
      {
        kind: 'create',
        memoId: 'A',
        body: {
          summary: '메모 A',
          description: 'https://memo.example.com/m/A',
          start: { date: '2026-10-20' },
          end: { date: '2026-10-23' },
          transparency: 'transparent',
          extendedProperties: { private: { memoId: 'A' } },
        },
      },
    ])
  })

  it('하루짜리는 다음 날이 끝이다. siteUrl 이 없으면 설명을 비운다', () => {
    const { ops } = planSync({ memos: [memo('A', '2026-12-31')], total: 1, events: [], siteUrl: '' })
    expect(ops[0]).toMatchObject({ kind: 'create', body: { description: '', end: { date: '2027-01-01' } } })
  })

  it('같으면 아무것도 하지 않는다', () => {
    const { ops } = planSync({
      memos: [memo('A', '2026-10-20', '2026-10-22'), memo('B', '2026-10-25')],
      total: 2,
      events: [event('e1', 'A', '2026-10-20', '2026-10-23'), event('e2', 'B', '2026-10-25', '2026-10-26')],
      siteUrl: SITE,
    })
    expect(ops).toEqual([])
  })

  it('제목·시작·끝 중 하나라도 다르면 고친다 — dateTime 을 지워 종일로 되돌린다', () => {
    const memos = [memo('A', '2026-10-20', null, '새 제목'), memo('B', '2026-10-25', '2026-10-26'), memo('C', '2026-10-27')]
    const events = [
      event('e1', 'A', '2026-10-20', '2026-10-21', '옛 제목'),
      event('e2', 'B', '2026-10-25', '2026-10-26'),
      { id: 'e3', summary: '메모 C', start: { dateTime: '2026-10-27T10:00:00+09:00' }, end: { dateTime: '2026-10-27T11:00:00+09:00' }, extendedProperties: { private: { memoId: 'C' } } },
    ]
    const { ops } = planSync({ memos, total: 3, events, siteUrl: SITE })
    expect(ops.map((o) => [o.kind, o.memoId])).toEqual([
      ['update', 'A'],
      ['update', 'B'],
      ['update', 'C'],
    ])
    expect(ops[1]).toMatchObject({
      eventId: 'e2',
      body: { start: { date: '2026-10-25', dateTime: null }, end: { date: '2026-10-27', dateTime: null } },
    })
    // 고칠 때는 색·알림·한가함 같은 사람이 구글에서 바꾼 값을 보내지 않는다
    expect(ops[0]).not.toHaveProperty('body.transparency')
    expect(ops[0]).not.toHaveProperty('body.extendedProperties')
  })

  it('설명만 다른 것은 고치지 않는다 (구글에서 메모를 덧붙여도 둔다)', () => {
    const e = { ...event('e1', 'A', '2026-10-20', '2026-10-21'), description: '구글에서 덧붙인 말' }
    expect(planSync({ memos: [memo('A', '2026-10-20')], total: 1, events: [e], siteUrl: SITE }).ops).toEqual([])
  })

  it('메모가 없어졌거나 날짜가 지워진 일정은 지운다', () => {
    const { ops, held } = planSync({
      memos: [memo('A', '2026-10-20')],
      total: 5,
      events: [event('e1', 'A', '2026-10-20', '2026-10-21'), event('e2', 'GONE', '2026-10-01', '2026-10-02')],
      siteUrl: SITE,
    })
    expect(held).toBeNull()
    expect(ops).toEqual([{ kind: 'delete', memoId: 'GONE', eventId: 'e2', reason: 'orphan' }])
  })

  it('memoId 없는 일정(사람이 직접 만든 것)은 손대지 않는다', () => {
    const { ops } = planSync({ memos: [], total: 3, events: [event('mine', null, '2026-10-20', '2026-10-21')], siteUrl: SITE })
    expect(ops).toEqual([])
  })

  it('같은 메모의 일정이 둘이면 맞는 쪽을 남기고 나머지를 지운다', () => {
    const { ops } = planSync({
      memos: [memo('A', '2026-10-20')],
      total: 1,
      events: [event('stale', 'A', '2026-10-19', '2026-10-20'), event('good', 'A', '2026-10-20', '2026-10-21')],
      siteUrl: SITE,
    })
    expect(ops).toEqual([{ kind: 'delete', memoId: 'A', eventId: 'stale', reason: 'duplicate' }])
  })

  describe('대량 삭제 차단', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => event(`e${i}`, `M${i}`, '2026-10-01', '2026-10-02'))

    it('활성 메모가 하나도 없으면(데이터 폴더가 빠진 서버) 지우지 않는다', () => {
      const { ops, held } = planSync({ memos: [], total: 0, events: many(1), siteUrl: SITE })
      expect(ops).toEqual([])
      expect(held).toEqual({ reason: 'empty', deletes: 1, existing: 1 })
    })

    it(`${MASS_DELETE_FREE}건 이하는 절반을 넘어도 지운다 — 일정이 한두 개일 때 평범한 삭제가 막히지 않게`, () => {
      const { ops, held } = planSync({ memos: [], total: 10, events: many(MASS_DELETE_FREE), siteUrl: SITE })
      expect(held).toBeNull()
      expect(ops).toHaveLength(MASS_DELETE_FREE)
    })

    it('그보다 많고 기존의 절반을 넘으면 삭제만 미룬다 — 생성·수정은 그대로 한다', () => {
      const events = many(MASS_DELETE_FREE + 1)
      const { ops, held } = planSync({ memos: [memo('NEW', '2026-10-20')], total: 10, events, siteUrl: SITE })
      expect(held).toEqual({ reason: 'many', deletes: MASS_DELETE_FREE + 1, existing: MASS_DELETE_FREE + 1 })
      expect(ops.map((o) => o.kind)).toEqual(['create'])
    })

    it('절반 이하면 많아도 지운다', () => {
      const keep = Array.from({ length: 5 }, (_, i) => memo(`M${i}`, '2026-10-01'))
      const { ops, held } = planSync({ memos: keep, total: 10, events: many(10), siteUrl: SITE })
      expect(held).toBeNull()
      expect(ops.filter((o) => o.kind === 'delete')).toHaveLength(5)
    })

    it('사람이 확인하면 미루지 않는다', () => {
      const { ops, held } = planSync({ memos: [], total: 0, events: many(8), siteUrl: SITE, allowMassDelete: true })
      expect(held).toBeNull()
      expect(ops).toHaveLength(8)
    })
  })
})
