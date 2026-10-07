/**
 * 모든 API 는 로그인이 필요하다 — 읽기도 (설계문서 §11). 이미지 경로(/api/files)도 여기에 걸린다.
 * 화면(HTML)은 SPA 껍데기뿐이라 열려 있어도 내용이 없다.
 */
const OPEN = new Set(['/api/auth/login', '/api/health'])

export default defineEventHandler(async (event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return
  // nuxt-auth-utils 의 세션 조회(/api/_auth/session)는 로그인 전에도 «비어 있음»을 답해야 한다.
  // 아이콘(/api/_nuxt_icon)은 공개 아이콘 데이터라 막지 않는다 — 막으면 로그인 화면의 아이콘이 빠진다.
  if (OPEN.has(path) || path.startsWith('/api/_auth/') || path.startsWith('/api/_nuxt_icon/')) return
  await requireUserSession(event)
})
