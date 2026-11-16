import { listDrafts } from '~/utils/memo-drafts'
import { createMemoRefresh } from '~/utils/memo-refresh'
import type { MemoRefreshState } from '~/utils/memo-refresh'
import type { MemoDraft } from '~/utils/memo-drafts'
import { screenScope } from '~/utils/last-screen'

const controllers = new WeakMap<object, ReturnType<typeof createMemoRefresh>>()
type PendingMemo = Pick<MemoDraft, 'id' | 'source' | 'review' | 'conflict'> & Pick<MemoDraft['input'], 'title'>

export function useMemoSync() {
  const app = useNuxtApp()
  const { session } = useUserSession()
  const tree = useMemoTree()
  const active = useActiveMemo()
  const state = useState<MemoRefreshState>('memo-sync-state', () => ({ status: 'idle', refreshedAt: null }))
  const online = useState('memo-online', () => typeof navigator === 'undefined' || navigator.onLine !== false)
  const pendingDrafts = useState('memo-pending-drafts', () => 0)
  const conflicts = useState('memo-conflict-drafts', () => 0)
  const pendingItems = useState<PendingMemo[]>('memo-pending-items', () => [])
  let controller = controllers.get(app)
  if (!controller) {
    controller = createMemoRefresh({
      scope: () => screenScope(session.value),
      online: () => online.value,
      visible: () => document.visibilityState === 'visible',
      refreshTree: tree.refresh,
      refreshActive: active.refresh,
      setState: value => { state.value = value },
      message: error => apiMessage(error, '새로고침하지 못했습니다. 다시 시도하세요.'),
    })
    controllers.set(app, controller)
  }
  function updateDrafts() {
    const drafts = listDrafts()
    pendingDrafts.value = drafts.length
    conflicts.value = drafts.filter(draft => draft.conflict).length
    pendingItems.value = drafts.map(({ id, input, source, review, conflict }) => ({ id, title: input.title, source, review, conflict }))
  }
  return { state, online, pendingDrafts, pendingItems, conflicts, refresh: controller.refresh, reset: controller.reset, updateDrafts }
}
