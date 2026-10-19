import { shouldRestoreScreen } from '~/utils/last-screen'

export default defineNuxtRouteMiddleware(async (to) => {
  const attempted = useState('last-screen-attempted', () => false)
  const revision = useState('last-screen-revision', () => 0)
  const current = ++revision.value
  const initial = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const restore = shouldRestoreScreen(initial, to.fullPath, attempted.value)
  // 어떤 진입이든 한 번만 판단한다. 명시적 링크·앱 안에서 홈 이동·뒤로가기를 덮지 않는다.
  attempted.value = true
  if (!restore || !useUserSession().loggedIn.value) return
  const path = await useLastScreen().restore()
  if (current === revision.value && path && path !== '/') return navigateTo(path, { replace: true })
})
