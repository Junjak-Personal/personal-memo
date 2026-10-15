/**
 * 로그인하지 않았으면 로그인 화면으로. SPA 라 세션은 앱이 뜰 때 nuxt-auth-utils 가 먼저 받아 둔다.
 * 실제 보호는 서버(server/middleware/auth.ts)가 한다 — 여기는 화면 이동만 정한다.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  // 로그인 뒤 돌아올 곳 — AI 연결 승인 화면(/oauth/consent?request=…)처럼 밖에서 들어온 주소를 잃지 않게
  if (!loggedIn.value && to.path !== '/login') return navigateTo(to.fullPath === '/' ? '/login' : { path: '/login', query: { next: to.fullPath } })
  if (loggedIn.value && to.path === '/login') return navigateTo(safeNext(to.query.next))
})
