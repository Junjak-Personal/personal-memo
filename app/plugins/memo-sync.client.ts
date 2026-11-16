import { screenScope } from '~/utils/last-screen'

export default defineNuxtPlugin(app => {
  const sync = useMemoSync()
  const { session } = useUserSession()
  const startup = useState('startup-phase', () => 'loading')
  let mounted = false
  function refresh() {
    sync.updateDrafts()
    if (mounted && ['ready', 'revealed'].includes(startup.value)) void sync.refresh()
  }
  function connection() {
    sync.online.value = navigator.onLine !== false
    if (sync.online.value) refresh()
    else sync.state.value = { status: 'offline', refreshedAt: sync.state.value.refreshedAt }
  }
  function visible() { if (document.visibilityState === 'visible') refresh() }
  function storage(event: StorageEvent) {
    if (event.key?.startsWith('memo-draft:')) sync.updateDrafts()
    else if (event.key === 'memo-saved-at') refresh()
  }
  window.addEventListener('focus', refresh)
  window.addEventListener('online', connection)
  window.addEventListener('offline', connection)
  window.addEventListener('storage', storage)
  window.addEventListener('memo-drafts-changed', sync.updateDrafts)
  document.addEventListener('visibilitychange', visible)
  const timer = setInterval(visible, 60_000)
  const stop = watch(() => screenScope(session.value), () => { sync.reset(); sync.updateDrafts() })
  app.hook('app:mounted', () => { mounted = true; sync.updateDrafts() })
  app.vueApp.onUnmount(() => {
    clearInterval(timer); stop()
    window.removeEventListener('focus', refresh)
    window.removeEventListener('online', connection)
    window.removeEventListener('offline', connection)
    window.removeEventListener('storage', storage)
    window.removeEventListener('memo-drafts-changed', sync.updateDrafts)
    document.removeEventListener('visibilitychange', visible)
  })
})
