/**
 * 화면 코드(청크)를 못 받아 이동이 실패했을 때.
 *
 * Nuxt 기본값(emitRouteChunkError: 'automatic')은 그 주소로 페이지를 통째로 다시 불러온다. 배포로 옛 청크가 사라진
 * 경우엔 맞지만, **오프라인**이면 브라우저 오류 화면(폰 껍데기에서는 「연결하지 못했습니다」)으로 넘어가 쓰던 화면을 잃는다.
 * 그래서 nuxt.config 에서 'manual' 로 두고 여기서 가른다:
 * - 오프라인 → 지금 화면에 머물고 알린다 (쓰던 내용은 기기에 보관돼 있다 — memo-drafts)
 * - 온라인 → 기본값처럼 그 주소로 다시 불러온다
 *
 * 🔴 브라우저는 한 번 실패한 동적 import 를 기억한다 — 오프라인에서 (미리 받기까지 포함해) 실패한 화면은 다시 연결돼도
 *    또 실패한다. 다시 불러오기만이 푼다. 그래서 «연결된 상태의 청크 오류»는 언제나 다시 불러온다.
 *    Nuxt 의 app:chunkError 는 빌드된 앱의 vite:preloadError 에서만 나서(개발 서버에서는 안 남) 오류 문구로도 가린다.
 */
const CHUNK_ERROR = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const toast = useToast()
  const chunkErrors = new Set<unknown>()

  router.beforeEach(() => {
    chunkErrors.clear()
  })
  nuxtApp.hook('app:chunkError', ({ error }) => {
    chunkErrors.add(error)
  })
  function isChunkError(error: unknown) {
    return chunkErrors.has(error) || (error instanceof Error && CHUNK_ERROR.test(error.message))
  }

  router.onError((error, to) => {
    if (!isChunkError(error)) return
    if (navigator.onLine === false) {
      toast.add({ color: 'warning', title: '연결이 없어 이 화면을 열 수 없습니다', description: '연결되면 다시 눌러 주세요.' })
      return
    }
    reloadNuxtApp({ path: to.fullPath, persistState: true })
  })
})
