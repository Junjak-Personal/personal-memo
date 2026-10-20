import type { MemoMeta } from '#shared/types/memo'
import { screenScope } from '~/utils/last-screen'

/** 선택 문서·인증 범위가 바뀌면 이전 참조 제목을 즉시 지운다. 편집기 준비를 기다리게 하지는 않는다. */
export function useMemoBacklinks(memoId: () => string) {
  const { session } = useUserSession()
  const rows = ref<MemoMeta[]>([])
  const error = ref('')
  const loading = ref(false)
  let revision = 0
  let mounted = false

  function clear() {
    ++revision
    rows.value = []
    error.value = ''
    loading.value = false
  }

  async function refresh() {
    clear()
    const scope = screenScope(session.value)
    const id = memoId()
    if (!mounted || !scope || !id) return
    const token = revision
    const valid = () => mounted && revision === token && scope === screenScope(session.value) && memoId() === id
    loading.value = true
    try {
      const result = await $fetch<MemoMeta[]>(`/api/memos/${encodeURIComponent(id)}/backlinks`)
      if (valid()) rows.value = result
    } catch (e) {
      if (valid()) error.value = apiMessage(e, '참조하는 메모를 불러오지 못했습니다')
    } finally {
      if (valid()) loading.value = false
    }
  }

  // 문서 식별자/인증은 이 컴포넌트 밖의 사건으로 바뀐다.
  watch([memoId, () => screenScope(session.value)], () => { clear(); if (mounted) void refresh() }, { flush: 'sync' })
  onMounted(() => { mounted = true; void refresh() })
  onBeforeUnmount(() => { mounted = false; clear() })
  return { rows, error, loading, refresh }
}
