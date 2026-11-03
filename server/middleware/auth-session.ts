/**
 * nuxt-auth-utils의 로그아웃 계약은 유지하면서 영속 쿠키를 명시적으로 만료시킨다.
 * h3 clearSession은 값만 빈 세션 쿠키로 바꾼다. WebKit 재실행에서도 이전 영속 쿠키가 남지 않게 한다.
 */
export default defineEventHandler(async (event) => {
  if (event.method !== 'DELETE' || getRequestURL(event).pathname !== '/api/_auth/session') return
  setResponseHeader(event, 'cache-control', 'no-store')
  await clearUserSession(event)
  deleteCookie(event, useRuntimeConfig().session.name, { path: '/' })
  return true
})
