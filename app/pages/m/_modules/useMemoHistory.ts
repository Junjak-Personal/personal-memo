import type { Memo } from '#shared/types/memo'
import type { MemoRevision, MemoRevisionSummary } from '#shared/types/memo-history'
import { screenScope } from '~/utils/last-screen'

interface Options {
  memoId: () => string
  version: () => string
  flush: () => Promise<boolean>
  onRestored: (memo: Memo) => void
}

/** 미리 본 시점의 편집 버전만 복원한다. 새 서버 버전을 받아 충돌 검사를 건너뛰지 않는다. */
export function useMemoHistory(options: Options) {
  const { session } = useUserSession()
  const open = ref(false)
  const loading = ref(false)
  const selecting = ref(false)
  const restoring = ref(false)
  const confirming = ref(false)
  const error = ref('')
  const conflict = ref(false)
  const revisions = ref<MemoRevisionSummary[]>([])
  const selected = ref<MemoRevision | null>(null)
  let request = 0
  let selection = 0
  let scope: string | null = null
  let memoId = ''
  let baseVersion = ''

  function valid(token: number) {
    return open.value && request === token && scope !== null && screenScope(session.value) === scope && options.memoId() === memoId
  }

  function close() {
    ++request
    ++selection
    open.value = false
    revisions.value = []
    selected.value = null
    error.value = ''
    conflict.value = false
    loading.value = selecting.value = restoring.value = confirming.value = false
    scope = null
    memoId = baseVersion = ''
  }

  // 인증 전환은 외부 이벤트다. 모달의 이전 제목·본문도 같은 tick에 지운다.
  watch(() => screenScope(session.value), close, { flush: 'sync' })
  onBeforeUnmount(close)

  async function show() {
    close()
    scope = screenScope(session.value)
    if (!scope) return
    open.value = true
    loading.value = true
    const token = request
    const initialScope = scope
    try {
      const saved = await options.flush()
      if (request !== token || !open.value || screenScope(session.value) !== initialScope) return
      if (!saved) {
        error.value = '현재 내용을 저장하지 못했습니다. 저장 상태를 확인한 뒤 다시 여세요.'
        return
      }
      // 경로 id는 flush의 첫 저장에서 ULID로 바뀔 수 있다.
      memoId = options.memoId()
      baseVersion = options.version()
      const list = await $fetch<MemoRevisionSummary[]>(`/api/memos/${encodeURIComponent(memoId)}/history`)
      if (!valid(token)) return
      revisions.value = list
      if (list[0]) await select(list[0].id)
    } catch (e) {
      if (request === token && open.value && screenScope(session.value) === initialScope) error.value = apiMessage(e, '수정 이력을 불러오지 못했습니다')
    } finally {
      if (request === token) loading.value = false
    }
  }

  async function select(id: string) {
    if (restoring.value || !revisions.value.some(revision => revision.id === id)) return
    const token = request
    const current = ++selection
    selected.value = null
    confirming.value = false
    error.value = ''
    conflict.value = false
    selecting.value = true
    try {
      const detail = await $fetch<MemoRevision>(`/api/memos/${encodeURIComponent(memoId)}/history/${encodeURIComponent(id)}`)
      if (valid(token) && selection === current) selected.value = detail
    } catch (e) {
      if (valid(token) && selection === current) error.value = apiMessage(e, '이 버전을 불러오지 못했습니다')
    } finally {
      if (valid(token) && selection === current) selecting.value = false
    }
  }

  async function restore() {
    const revision = selected.value
    const token = request
    if (!revision || restoring.value || !confirming.value || !valid(token)) return
    restoring.value = true
    error.value = ''
    conflict.value = false
    try {
      if (!(await options.flush())) {
        if (valid(token)) error.value = '현재 내용을 저장하지 못해 복원하지 않았습니다.'
        return
      }
      if (!valid(token)) return
      if (options.version() !== baseVersion) {
        error.value = '현재 내용이 바뀌었습니다. 수정 이력을 다시 열고 확인하세요.'
        confirming.value = false
        return
      }
      const restored = await $fetch<Memo>(`/api/memos/${encodeURIComponent(memoId)}/history/${encodeURIComponent(revision.id)}/restore`, {
        method: 'POST', body: { baseVersion },
      })
      if (!valid(token)) return
      close()
      options.onRestored(restored)
    } catch (e) {
      if (valid(token)) {
        conflict.value = apiStatus(e) === 409
        error.value = conflict.value
          ? '다른 곳에서 먼저 수정해 복원하지 않았습니다. 현재 메모를 다시 불러온 뒤 확인하세요.'
          : apiMessage(e, '복원하지 못했습니다. 현재 메모를 다시 확인한 뒤 재시도하세요.')
        confirming.value = false
      }
    } finally {
      if (request === token) restoring.value = false
    }
  }

  return { open, loading, selecting, restoring, confirming, error, conflict, revisions, selected, show, close, select, restore }
}
