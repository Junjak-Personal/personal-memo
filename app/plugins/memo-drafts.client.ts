/**
 * 보관함 — 이 기기에 보관해 둔(서버에 닿지 못한) 수정을 연결이 돌아오면 대신 저장한다 (오프라인 보호, memo-drafts).
 *
 * 열려 있는 메모는 그 화면의 자동저장이 맡으므로 건너뛴다. 서버가 그 사이 바뀌어 409 가 나면 충돌로 표시만 하고
 * 남겨 둔다 — 그 메모를 열면 화면이 「어느 쪽을 남길지」 묻는다. 조용히 덮어쓰지 않는다.
 *
 * 시점: 앱이 뜬 뒤, online 이벤트, 앱이 다시 보일 때, 보관된 게 있으면 1분마다.
 */
import { isNetworkError, listDrafts, removeDraft, writeDraft } from '~/utils/memo-drafts'

const RETRY_MS = 60_000

export default defineNuxtPlugin((nuxtApp) => {
  const activeMemo = useActiveMemo()
  const { refresh } = useMemoTree()
  const toast = useToast()
  let running = false

  async function flushDrafts() {
    if (running || navigator.onLine === false) return
    running = true
    let saved = 0
    try {
      for (const draft of listDrafts()) {
        if (draft.conflict || activeMemo.isOpen(draft.id)) continue
        try {
          await $fetch(`/api/memos/${encodeURIComponent(draft.id)}`, {
            method: 'PUT',
            body: { ...draft.input, baseVersion: draft.baseVersion },
          })
          removeDraft(draft.id)
          saved++
        } catch (e) {
          const status = apiStatus(e)
          if (status === 409) writeDraft({ ...draft, conflict: true })
          // 아직 닿지 않거나 로그인 전이면 나머지도 안 된다 — 다음 기회에
          else if (isNetworkError(e) || status === 401) break
          // 그 밖(메모가 지워짐 등)은 남겨 둔다 — 지우면 되살릴 길이 없다
        }
      }
    } finally {
      running = false
    }
    if (saved) {
      await refresh()
      toast.add({ title: `이 기기에 보관해 둔 수정 ${saved}개를 저장했습니다` })
    }
  }

  window.addEventListener('online', () => void flushDrafts())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushDrafts()
  })
  setInterval(() => {
    if (listDrafts().length) void flushDrafts()
  }, RETRY_MS)
  nuxtApp.hook('app:mounted', () => void flushDrafts())
})
