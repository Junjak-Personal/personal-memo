/**
 * 구글 캘린더 동기화 실행기 (설계문서 §8.3). 언제 대조할지와 결과(실패 기록)를 맡는다.
 *
 * 상태를 파일에 저장하지 않는다 — 대조가 매번 캘린더 전체를 받아 맞추므로, 서버가 꺼져 있던 동안의 변경·
 * 실패한 시도·vim 으로 고친 것이 다음 대조에서 같은 방식으로 맞춰진다. 여기 있는 것은 화면에 보여 줄 기록뿐이다.
 *
 * 대조는 한 번에 하나만 돈다. 도는 중에 또 부르면 끝난 뒤 한 번 더 돈다(여러 번 불러도 한 번).
 */
import type { CalendarSyncStatus, HeldDeletes } from '../../shared/types/calendar-sync'
import type { MemoMeta } from '../../shared/types/memo'
import { nowKst } from '../../shared/utils/memo-date'
import type { CalendarApi } from './google'
import { type EventShape, memoIdOf, planSync, sameShape, shapeOfEvent, shapeOfMemo, type SyncMemo, type SyncOp } from './reconcile'

/** 저장 직후 대조까지 기다리는 시간 — 날짜를 고르며 몇 번 바꿔도 한 번만 맞춘다 */
export const SYNC_DEBOUNCE_MS = 2000

export interface MemoSnapshot {
  /** 메모 파일 수 (휴지통 포함) */
  total: number
  /** id 가 있고 날짜가 있는 활성 메모 */
  memos: MemoMeta[]
}

interface Deps {
  api: CalendarApi
  snapshot: () => Promise<MemoSnapshot>
  siteUrl: string
  debounceMs?: number
  log?: (message: string) => void
}

export class CalendarSync {
  private active: Promise<void> | null = null
  private queued: Promise<void> | null = null
  private queuedAllowMass = false
  private timer: ReturnType<typeof setTimeout> | null = null

  private lastRunAt: string | null = null
  private lastOkAt: string | null = null
  private error: string | null = null
  private held: HeldDeletes | null = null
  private failures = new Map<string, string>()
  /** 마지막 대조가 본 캘린더 쪽 모양. 저장할 때 「캘린더에 반영할 게 있나」를 이것으로 거른다. null = 아직 모름 */
  private known: Map<string, EventShape> | null = null

  constructor(private readonly deps: Deps) {}

  status(): CalendarSyncStatus {
    return {
      state: 'on',
      running: this.active !== null,
      lastRunAt: this.lastRunAt,
      lastOkAt: this.lastOkAt,
      error: this.error,
      held: this.held,
      failures: Object.fromEntries(this.failures),
    }
  }

  /** 지금 대조한다. 이미 도는 중이면 그게 끝난 뒤 한 번 더 돈다 */
  run(options: { allowMassDelete?: boolean } = {}): Promise<void> {
    if (!this.active) {
      this.active = this.runOnce(options.allowMassDelete ?? false).finally(() => {
        this.active = null
      })
      return this.active
    }
    this.queuedAllowMass ||= options.allowMassDelete ?? false
    this.queued ??= this.active.then(() => {
      const allowMassDelete = this.queuedAllowMass
      this.queued = null
      this.queuedAllowMass = false
      return this.run({ allowMassDelete })
    })
    return this.queued
  }

  /** 잠시 뒤 대조한다. 그 사이에 또 부르면 다시 기다린다 */
  schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, this.deps.debounceMs ?? SYNC_DEBOUNCE_MS)
  }

  /**
   * 앱에서 메모를 만들거나 고치거나 되살린 뒤. 캘린더에 보일 모양(제목·날짜)이 마지막으로 본 캘린더와
   * 같으면 대조하지 않는다 — 본문만 고친 저장이 1초마다 구글을 부르지 않게.
   */
  notify(memo: MemoMeta) {
    if (memo.id.startsWith('p:')) return
    const want = memo.date ? shapeOfMemo({ ...memo, date: memo.date }) : null
    if (this.known && !this.failures.has(memo.id) && sameShape(this.known.get(memo.id) ?? null, want)) return
    this.schedule()
  }

  /** 앱에서 메모를 휴지통으로 보낸 뒤 */
  notifyRemoved(memoId: string) {
    if (this.known && !this.known.has(memoId)) return
    this.schedule()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async runOnce(allowMassDelete: boolean) {
    this.lastRunAt = nowKst()
    let snapshot: MemoSnapshot
    let events
    try {
      // 캘린더를 먼저 받는다 — 받는 동안 저장된 메모는 이번 스냅숏에 들어가고, 못 들어가면 다음 대조가 맞춘다
      events = await this.deps.api.list()
      snapshot = await this.deps.snapshot()
    } catch (e) {
      this.error = messageOf(e)
      this.deps.log?.(`대조 실패: ${this.error}`)
      return
    }

    const memos: SyncMemo[] = snapshot.memos.flatMap((m) => (m.date && !m.id.startsWith('p:') ? [{ ...m, date: m.date }] : []))
    const plan = planSync({ memos, total: snapshot.total, events, siteUrl: this.deps.siteUrl, allowMassDelete })
    const byId = new Map(memos.map((m) => [m.id, m]))
    const known = new Map<string, EventShape>()
    for (const event of events) {
      const memoId = memoIdOf(event)
      if (memoId && !known.has(memoId)) known.set(memoId, shapeOfEvent(event))
    }

    const failures = new Map<string, string>()
    for (const op of plan.ops) {
      try {
        await this.apply(op)
        const memo = byId.get(op.memoId)
        if (op.kind === 'delete' && op.reason === 'orphan') known.delete(op.memoId)
        else if (memo) known.set(op.memoId, shapeOfMemo(memo))
      } catch (e) {
        failures.set(op.memoId, messageOf(e))
      }
    }

    this.known = known
    this.failures = failures
    this.held = plan.held
    this.error = null
    if (!failures.size && !plan.held) this.lastOkAt = nowKst()
    if (plan.ops.length || plan.held || failures.size) {
      const done = plan.ops.length - failures.size
      this.deps.log?.(
        `대조 ${done}/${plan.ops.length} 반영` +
          (failures.size ? `, 실패 ${failures.size}` : '') +
          (plan.held ? `, 삭제 ${plan.held.deletes}건 보류(${plan.held.reason})` : ''),
      )
    }
  }

  private async apply(op: SyncOp) {
    switch (op.kind) {
      case 'create':
        await this.deps.api.insert(op.body)
        return
      case 'update':
        await this.deps.api.patch(op.eventId, op.body)
        return
      case 'delete':
        await this.deps.api.remove(op.eventId)
    }
  }
}

function messageOf(error: unknown) {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' ? '구글 캘린더 응답이 없습니다 (시간 초과)' : error.message
  }
  return String(error)
}
