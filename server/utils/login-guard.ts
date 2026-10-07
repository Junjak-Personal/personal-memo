/**
 * 로그인 잠금 — 연속 5회 실패하면 15분 잠근다 (설계문서 §11).
 *
 * 실패 지연(400ms)만으로는 병렬 요청을 못 막는다. 메모리 카운터라 재시작하면 풀린다 — 수용.
 * 사용자가 한 명이라 IP 별이 아니라 전체로 센다. 그래서 남이 일부러 틀려서 나를 15분 잠글 수는 있다 —
 * 비밀번호를 맞히게 두는 것보다 낫다.
 */
const LIMIT = 5
const LOCK_MS = 15 * 60 * 1000

let failures = 0
let lockedUntil = 0

export function assertLoginAllowed() {
  const left = lockedUntil - Date.now()
  if (left > 0) {
    const minutes = Math.ceil(left / 60_000)
    throw createError({
      statusCode: 429,
      statusMessage: 'locked',
      message: `로그인 시도가 너무 많습니다. ${minutes}분 뒤에 다시 시도하세요`,
      data: { code: 'locked', message: `로그인 시도가 너무 많습니다. ${minutes}분 뒤에 다시 시도하세요` },
    })
  }
}

export function recordLoginFailure() {
  failures++
  if (failures >= LIMIT) {
    lockedUntil = Date.now() + LOCK_MS
    failures = 0
  }
}

export function recordLoginSuccess() {
  failures = 0
  lockedUntil = 0
}
