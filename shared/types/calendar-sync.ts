/**
 * 구글 캘린더 동기화 상태 (설계문서 §8.3). 서버 메모리에만 있다 — 재시작하면 다음 대조가 다시 채운다.
 */

/** 삭제를 미뤄 둔 이유. 둘 다 「데이터 폴더가 빠진 채 서버가 떠서 일정이 전부 지워지는」 사고를 막는다 */
export interface HeldDeletes {
  /** empty — 메모 파일이 하나도 없다(휴지통 포함), many — 한 번에 지울 일정이 너무 많다 */
  reason: 'empty' | 'many'
  /** 지우려던 일정 수 */
  deletes: number
  /** 캘린더에 있던 메모 일정 수 */
  existing: number
}

export type CalendarSyncStatus =
  /** 설정이 없다 — 개발 기본값. 실제 「메모」 캘린더에 로컬 샘플이 섞이지 않게 */
  | { state: 'off'; message: string }
  /** 설정은 있는데 쓸 수 없다 (서비스 계정 키를 못 읽음 등) */
  | { state: 'broken'; message: string }
  | {
      state: 'on'
      running: boolean
      /** 마지막으로 대조를 시작한 시각 (KST) */
      lastRunAt: string | null
      /** 마지막으로 실패 없이 끝난 시각 (KST) */
      lastOkAt: string | null
      /** 대조 자체가 실패했다 (인증·목록 받기). 이때 failures 는 직전 값을 유지한다 */
      error: string | null
      held: HeldDeletes | null
      /** 메모 id → 반영하지 못한 이유 */
      failures: Record<string, string>
    }
