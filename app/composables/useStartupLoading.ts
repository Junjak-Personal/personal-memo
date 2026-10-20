import type { StartupPhase } from '~/utils/startup-loading'

export function useStartupLoading() {
  const phase = useState<StartupPhase>('startup-phase', () => 'loading')
  const startup = useNuxtApp().$startup
  return { phase, memoReady: startup.memoReady, reveal: startup.reveal }
}
