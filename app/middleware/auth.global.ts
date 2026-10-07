/**
 * 로그인하지 않았으면 로그인 화면으로. SPA 라 세션은 앱이 뜰 때 nuxt-auth-utils 가 먼저 받아 둔다.
 * 실제 보호는 서버(server/middleware/auth.ts)가 한다 — 여기는 화면 이동만 정한다.
 */
export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (!loggedIn.value && to.path !== '/login') return navigateTo('/login')
  if (loggedIn.value && to.path === '/login') return navigateTo('/')
})
