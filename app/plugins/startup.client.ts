import { screenScope } from '~/utils/last-screen'
import { createStartupGate, startupRequests, type StartupPhase } from '~/utils/startup-loading'

declare global {
  interface Window {
    memoStartup?: { ready: boolean; failed: boolean; timings?: Record<string, number> }
    MemoStartup?: { postMessage: (message: string) => void }
  }
}

export default defineNuxtPlugin({
  name: 'memo-startup',
  enforce: 'pre',
  setup(nuxtApp) {
    const phase = useState<StartupPhase>('startup-phase', () => 'loading')
    const { session } = useUserSession()
    const treeRequests = useState('startup-tree-requests', () => 0)
    const stages: Record<string, number> = { pluginMs: Math.round(performance.now()) }
    window.memoStartup = { ready: false, failed: false }
    const mark = (stage: string) => { stages[stage] = Math.round(performance.now()) }
    let paint = 0
    let revision = 0
    const timeout = window.setTimeout(() => {
      if (phase.value === 'loading') phase.value = 'slow'
    }, Math.max(0, 15000 - performance.now()))

    function publish(failed: boolean) {
      if (window.memoStartup?.ready || window.memoStartup?.failed) return
      clearTimeout(timeout)
      window.memoStartup = {
        ready: !failed, failed,
        timings: {
          ...stages,
          ...startupRequests(performance.getEntriesByType('resource') as PerformanceResourceTiming[], location.origin),
          // 일부 WebView는 fetch ResourceTiming을 제공하지 않아 실제 tree 시작 횟수도 센다.
          treeRequests: treeRequests.value,
        },
      }
      // 개발 도구에서도 숫자 계측을 확인할 수 있다. 주소·계정·메모 정보는 포함하지 않는다.
      document.documentElement.dataset.memoStartup = JSON.stringify(window.memoStartup)
      try { window.MemoStartup?.postMessage(JSON.stringify({ type: failed ? 'error' : 'ready' })) } catch { /* 구버전 네이티브와 일반 웹에서도 열린다 */ }
    }

    const gate = createStartupGate((commit) => {
      // mounted/nextTick 뒤 한 프레임을 그릴 기회를 준다. 고정된 최소 표시 시간은 없다.
      cancelAnimationFrame(paint)
      paint = requestAnimationFrame(() => {
        if (phase.value === 'failed' || !commit()) return
        mark('readyMs')
        phase.value = 'ready'
        publish(false)
      })
    })

    nuxtApp.hook('page:start', () => gate.pagePending())
    nuxtApp.hook('page:finish', () => {
      mark('pageMs')
      const route = nuxtApp.$router.currentRoute.value
      const id = /^\/m\/[^/]+$/.test(route.path) ? String(route.params.id) : null
      gate.pageReady(id, route.meta.layout !== false && !!screenScope(session.value))
    })
    nuxtApp.hook('app:mounted', () => { mark('mountedMs'); gate.mounted() })
    nuxtApp.hook('app:error', () => {
      if (phase.value === 'ready' || phase.value === 'revealed') return
      gate.stop()
      cancelAnimationFrame(paint)
      phase.value = 'failed'
      mark('failedMs')
      publish(true)
    })
    nuxtApp.hook('app:created', () => {
      mark('pluginsMs')
      const { settled } = useMemoTree()
      async function loadTree() {
        if (phase.value === 'ready' || phase.value === 'revealed' || phase.value === 'failed') return
        const current = ++revision
        const scope = screenScope(session.value)
        gate.treePending()
        if (scope && nuxtApp.$router.currentRoute.value.meta.layout !== false) {
          try { await settled() } catch { /* sidebar가 오류와 새로고침을 표시한다 */ }
        }
        if (current !== revision || scope !== screenScope(session.value)) return
        mark('treeSettledMs')
        gate.treeSettled()
      }
      // 외부 인증 이벤트의 이전 요청은 첫 화면 준비를 완료할 수 없다.
      const stop = watch(() => screenScope(session.value), () => void loadTree(), { flush: 'sync' })
      void loadTree()
      nuxtApp.vueApp.onUnmount(stop)
    })
    nuxtApp.vueApp.onUnmount(() => { clearTimeout(timeout); cancelAnimationFrame(paint); gate.stop() })

    return { provide: { startup: {
      memoReady(id: string) {
        if (String(nuxtApp.$router.currentRoute.value.params.id) !== id) return
        mark('editorMs')
        gate.contentReady(id)
      },
      reveal() {
        clearTimeout(timeout)
        phase.value = 'revealed'
        // 사용자 복구 선택은 준비 완료 신호로 둔갑시키지 않는다.
      },
    } } }
  },
})
