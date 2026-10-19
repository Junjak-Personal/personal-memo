import { screenScope } from '~/utils/last-screen'

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const { session } = useUserSession()
  const last = useLastScreen()
  let mounted = false
  let revision = 0

  function remember() {
    const current = ++revision
    const fullPath = router.currentRoute.value.fullPath
    void last.remember(fullPath, () => current === revision && router.currentRoute.value.fullPath === fullPath)
  }

  // 인증 상태 변경은 외부 이벤트다. 대기 중인 검증을 무효화해 이전 세션 주소의 재저장을 막는다.
  watch(() => screenScope(session.value), (scope, previous) => {
    ++revision
    if (!scope || (previous && scope !== previous)) last.forget()
  }, { flush: 'sync' })

  nuxtApp.hook('app:mounted', () => {
    mounted = true
    remember()
  })
  router.afterEach((_to, _from, failure) => {
    if (!failure && mounted) remember()
  })
})
