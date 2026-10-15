/**
 * 로그인 뒤 돌아갈 곳 — 이 앱 안의 경로만 (`/oauth/consent?request=…`). 다른 사이트로 보내는 데 쓰이지 않게
 * `//evil.example`·`https:`·`/login` 은 처음 화면으로 돌린다.
 */
export function safeNext(next: unknown) {
  const path = Array.isArray(next) ? next[0] : next
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\') || path.startsWith('/login')) return '/'
  return path
}
