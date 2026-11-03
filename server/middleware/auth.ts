/**
 * 모든 API 는 로그인이 필요하다 — 읽기도 (설계문서 §11). 이미지 경로(/api/files)도 여기에 걸린다.
 * 화면(HTML)은 SPA 껍데기뿐이라 열려 있어도 내용이 없다.
 * 예외: 외부 공개(/api/ext/, §11.2) — `public: true` 인 메모만 저장소가 내준다.
 */
const OPEN = new Set(['/api/auth/login', '/api/health'])

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  // WKWebView가 재실행 때 이전 세션 응답을 재사용하면 로그아웃한 화면이 다시 열린다.
  // 인증 상태·개인 메모 응답은 HTTP 캐시에 남기지 않는다 (데스크톱 MVP 실측).
  setResponseHeader(event, 'cache-control', 'no-store')
  // nuxt-auth-utils 의 세션 조회(/api/_auth/session)는 로그인 전에도 «비어 있음»을 답해야 한다.
  // 아이콘(/api/_nuxt_icon)은 공개 아이콘 데이터라 막지 않는다 — 막으면 로그인 화면의 아이콘이 빠진다.
  if (OPEN.has(path) || path.startsWith('/api/_auth/') || path.startsWith('/api/_nuxt_icon/') || path.startsWith('/api/ext/')) return
  await requireUserSession(event)
})
