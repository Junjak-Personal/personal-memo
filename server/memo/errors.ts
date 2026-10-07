/**
 * 저장소가 던지는 오류. HTTP 계층(server/utils/http.ts)이 상태 코드로 바꾼다.
 * 저장소는 h3 를 모른다 — Nuxt 없이 Vitest 로 바로 검사하기 위해서다.
 */
export type MemoErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'unreadable'
  | 'too_large'
  | 'unsupported_type'

const STATUS: Record<MemoErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  unreadable: 422,
  too_large: 413,
  unsupported_type: 415,
}

export class MemoError extends Error {
  readonly status: number

  constructor(
    readonly code: MemoErrorCode,
    message: string,
    /** 409 의 현재 version 처럼 화면이 쓸 값 */
    readonly extra: Record<string, string> = {},
  ) {
    super(message)
    this.status = STATUS[code]
  }
}
