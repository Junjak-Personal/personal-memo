import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoMeta } from '../../shared/types/memo'
import type { CalendarApi, EventWrite, GoogleEvent } from './google'
import { CalendarSync, type MemoSnapshot } from './sync'

/** 구글 캘린더 흉내 — 메모리에 일정을 들고, 원하면 특정 memoId 의 쓰기를 실패시킨다 */
class FakeCalendar implements CalendarApi {
  events = new Map<string, GoogleEvent>()
  calls: string[] = []
  failFor = new Set<string>()
  listError: Error | null = null
  private seq = 0

  async list() {
    this.calls.push('list')
    if (this.listError) throw this.listError
    return [...this.events.values()]
  }

  async insert(body: EventWrite) {
    this.calls.push(`insert ${body.summary}`)
    const memoId = body.extendedProperties?.private?.memoId ?? ''
    if (this.failFor.has(memoId)) throw new Error('구글 캘린더 일정 만들기 실패 (403): forbidden')
    const event = { ...body, id: `ev${++this.seq}` }
    this.events.set(event.id, event)
    return event
  }

  async patch(eventId: string, body: EventWrite) {
    this.calls.push(`patch ${eventId}`)
    const current = this.events.get(eventId)!
    const memoId = current.extendedProperties?.private?.memoId ?? ''
    if (this.failFor.has(memoId)) throw new Error('구글 캘린더 일정 고치기 실패 (500): backend')
    const next = { ...current, ...body, id: eventId }
    this.events.set(eventId, next)
    return next
  }

  async remove(eventId: string) {
    this.calls.push(`remove ${eventId}`)
    this.events.delete(eventId)
  }
}

function meta(id: string, date: string | null, title = `메모 ${id}`, dateEnd: string | null = null): MemoMeta {
  return { id, path: `할 일/${title}.md`, folder: '할 일', title, created: null, updated: null, date, dateEnd, tags: [], done: false, priority: 'medium', public: false, unreadable: false }
}

let api: FakeCalendar
let memos: MemoMeta[]
let total: number
let sync: CalendarSync

beforeEach(() => {
  api = new FakeCalendar()
  memos = []
  total = 0
  const snapshot = async (): Promise<MemoSnapshot> => ({ total: total || memos.length, memos: memos.filter((m) => m.date) })
  sync = new CalendarSync({ api, snapshot, siteUrl: '', debounceMs: 100 })
})

afterEach(() => {
  sync.stop()
  vi.useRealTimers()
})

describe('CalendarSync', () => {
  it('날짜 있는 일반 메모는 구글 일정으로 만들지 않고, 본문·날짜 변경 알림도 대조하지 않는다', async () => {
    const journal = { ...meta('J', '2026-10-20'), done: null, folder: '개인/일지' }
    memos = [journal, { ...meta('T', '2026-10-20'), done: false }]
    await sync.run()
    expect([...api.events.values()].map(event => event.summary)).toEqual(['메모 T'])

    api.calls = []
    vi.useFakeTimers()
    sync.notify({ ...journal, date: '2026-10-21' })
    await vi.advanceTimersByTimeAsync(500)
    expect(api.calls).toEqual([])
  })

  it('기존 일반 메모 일정은 정리하고 미완료 할 일과 직접 만든 구글 일정은 보존한다', async () => {
    memos = [{ ...meta('J', '2026-10-20'), done: null }, { ...meta('T', '2026-10-20'), done: false }]
    api.events.set('old-journal', { id: 'old-journal', summary: '일지', start: { date: '2026-10-20' }, end: { date: '2026-10-21' }, extendedProperties: { private: { memoId: 'J' } } })
    api.events.set('manual', { id: 'manual', summary: '직접 만든 일정', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } })
    await sync.run()
    expect(api.events.has('old-journal')).toBe(false)
    expect(api.events.has('manual')).toBe(true)
    expect([...api.events.values()].some(event => event.extendedProperties?.private?.memoId === 'T')).toBe(true)
  })

  it('대조 결과를 반영하고 상태를 남긴다', async () => {
    memos = [meta('A', '2026-10-20'), meta('B', null)]
    await sync.run()
    expect([...api.events.values()].map((e) => e.summary)).toEqual(['메모 A'])
    const status = sync.status()
    expect(status).toMatchObject({ state: 'on', running: false, error: null, held: null, failures: {} })
    if (status.state === 'on') expect(status.lastOkAt).not.toBeNull()
  })

  it('메모별 실패를 기록하고, 다음 대조에서 성공하면 지운다', async () => {
    memos = [meta('A', '2026-10-20'), meta('B', '2026-10-21')]
    api.failFor.add('B')
    await sync.run()
    expect(sync.status()).toMatchObject({ failures: { B: expect.stringContaining('403') } })
    expect(api.events.size).toBe(1)

    api.failFor.clear()
    await sync.run()
    expect(sync.status()).toMatchObject({ failures: {} })
    expect(api.events.size).toBe(2)
  })

  it('목록을 못 받으면 대조 오류로 남기고 아무것도 쓰지 않는다', async () => {
    memos = [meta('A', '2026-10-20')]
    api.listError = new Error('구글 인증 실패 (400): invalid_grant')
    await sync.run()
    expect(sync.status()).toMatchObject({ error: expect.stringContaining('invalid_grant') })
    expect(api.calls).toEqual(['list'])

    api.listError = null
    await sync.run()
    expect(sync.status()).toMatchObject({ error: null })
  })

  it('대량 삭제가 미뤄지면 held 로 남고, 확인하고 다시 돌리면 지운다', async () => {
    memos = Array.from({ length: 6 }, (_, i) => meta(`M${i}`, '2026-10-01'))
    await sync.run()
    expect(api.events.size).toBe(6)

    memos = [meta('other', null)]
    await sync.run()
    expect(sync.status()).toMatchObject({ held: { reason: 'many', deletes: 6, existing: 6 } })
    expect(api.events.size).toBe(6)

    await sync.run({ allowMassDelete: true })
    expect(sync.status()).toMatchObject({ held: null })
    expect(api.events.size).toBe(0)
  })

  it('도는 중에 여러 번 부르면 끝난 뒤 한 번만 더 돈다', async () => {
    memos = [meta('A', '2026-10-20')]
    const first = sync.run()
    const second = sync.run()
    const third = sync.run()
    expect(second).toBe(third)
    await Promise.all([first, second, third])
    expect(api.calls.filter((c) => c === 'list')).toHaveLength(2)
    expect(api.events.size).toBe(1)
  })

  describe('저장 뒤 알림', () => {
    beforeEach(async () => {
      memos = [meta('A', '2026-10-20')]
      await sync.run()
      api.calls = []
      vi.useFakeTimers()
    })

    it('캘린더에 보일 모양이 같으면(본문만 고침) 대조하지 않는다', async () => {
      sync.notify(meta('A', '2026-10-20'))
      await vi.advanceTimersByTimeAsync(500)
      expect(api.calls).toEqual([])
    })

    it('제목·날짜가 바뀌면 잠시 뒤 한 번 대조한다 — 연달아 바뀌어도 한 번', async () => {
      memos = [meta('A', '2026-10-22', '새 제목')]
      sync.notify(meta('A', '2026-10-21'))
      await vi.advanceTimersByTimeAsync(50)
      sync.notify(meta('A', '2026-10-22', '새 제목'))
      await vi.advanceTimersByTimeAsync(500)
      expect(api.calls.filter((c) => c === 'list')).toHaveLength(1)
      expect([...api.events.values()][0]).toMatchObject({ summary: '새 제목', start: { date: '2026-10-22' } })
    })

    it.each([true, null])('할 일 상태가 %s면 제목·날짜가 그대로여도 일정을 지우고, 다시 미완료로 두면 만든다', async done => {
      const finished = { ...meta('A', '2026-10-20'), done }
      // 일반 메모와 끝난 할 일은 스냅숏이 넘겨도 일정에서 빠진다.
      memos = [finished]
      sync.notify(finished)
      await vi.advanceTimersByTimeAsync(500)
      expect(api.calls).toContain('list')
      expect(api.events.size).toBe(0)

      const reopened = { ...meta('A', '2026-10-20'), done: false }
      memos = [reopened]
      sync.notify(reopened)
      await vi.advanceTimersByTimeAsync(500)
      expect([...api.events.values()][0]).toMatchObject({ summary: '메모 A', start: { date: '2026-10-20' } })
    })

    it('경로 id(p:)는 아직 잇지 않는다', async () => {
      sync.notify(meta('p:밖에서 만든.md', '2026-10-20'))
      await vi.advanceTimersByTimeAsync(500)
      expect(api.calls).toEqual([])
    })

    it('휴지통 — 캘린더에 없던 메모면 대조하지 않는다', async () => {
      sync.notifyRemoved('NO_EVENT')
      await vi.advanceTimersByTimeAsync(500)
      expect(api.calls).toEqual([])

      memos = []
      total = 1
      sync.notifyRemoved('A')
      await vi.advanceTimersByTimeAsync(500)
      expect(api.calls).toContain('list')
      expect(api.events.size).toBe(0)
    })
  })
})
