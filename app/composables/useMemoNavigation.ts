import type { MemoNavigationState } from '#shared/types/memo-navigation'
import { screenScope } from '~/utils/last-screen'
import { createMemoNavigation } from '~/utils/memo-navigation'

const controllers = new WeakMap<object, ReturnType<typeof createMemoNavigation>>()

export function useMemoNavigation() {
  const app = useNuxtApp()
  const { session } = useUserSession()
  const { tree } = useMemoTree()
  const state = useState<MemoNavigationState | null>('memo-navigation', () => null)
  const error = useState<string | null>('memo-navigation-error', () => null)
  const pending = useState('memo-navigation-pending', () => false)
  let controller = controllers.get(app)
  if (!controller) {
    controller = createMemoNavigation({
      scope: () => screenScope(session.value),
      state: () => state.value,
      setState: (value) => { state.value = value },
      setError: (value) => { error.value = value },
      setPending: (value) => { pending.value = value },
      load: () => $fetch<MemoNavigationState>('/api/navigation'),
      opened: (id, previousId) => $fetch<MemoNavigationState>('/api/navigation/open', { method: 'POST', body: { id, previousId } }),
      favorite: (id, favorite) => $fetch<MemoNavigationState>('/api/navigation/favorite', { method: 'PUT', body: { id, favorite } }),
      message: (cause) => apiMessage(cause, '최근 메모·즐겨찾기를 불러오거나 저장하지 못했습니다'),
    })
    controllers.set(app, controller)
    const shared = controller
    // 인증은 이 composable 밖에서도 바뀌므로 동기 감시로 이전 목록을 즉시 지운다.
    const scope = effectScope(true)
    scope.run(() => watch(() => screenScope(session.value), () => shared.syncScope(), { flush: 'sync' }))
    app.vueApp.onUnmount(() => scope.stop())
  }
  controller.syncScope()
  const available = computed(() => new Map(tree.value?.memos.filter((memo) => !memo.unreadable).map((memo) => [memo.id, memo]) ?? []))
  const favorites = computed(() => (state.value?.favorites ?? []).flatMap((id) => available.value.get(id) ?? []))
  const recent = computed(() => (state.value?.recent ?? []).flatMap((id) => available.value.get(id) ?? []))
  const isFavorite = (id: string) => state.value?.favorites.includes(id) ?? false

  return { state, error, pending, favorites, recent, isFavorite, ...controller }
}
