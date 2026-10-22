import type { Memo } from '#shared/types/memo'
import type { MemoTemplate, MemoTemplateSummary } from '#shared/types/memo-templates'
import { isUlid } from '#shared/utils/ulid'
import { screenScope } from '~/utils/last-screen'

/** 모달마다 별도 수명. 인증 전환과 닫기는 대기 중 응답까지 무효화한다. */
function useTemplateScope(reset: () => void) {
  const { session } = useUserSession()
  const open = ref(false)
  let revision = 0
  let scope: string | null = null
  function close() {
    ++revision
    open.value = false
    scope = null
    reset()
  }
  function begin(preserve = false) {
    if (preserve && current()) return ++revision
    close()
    scope = screenScope(session.value)
    open.value = scope !== null
    return revision
  }
  function current(token = revision) {
    return open.value && token === revision && scope !== null && screenScope(session.value) === scope
  }
  // 인증은 외부에서 바뀐다. 이전 계정의 이름·원문은 같은 tick에 지운다.
  watch(() => screenScope(session.value), close, { flush: 'sync' })
  onBeforeUnmount(close)
  return { open, close, begin, current, token: () => revision }
}

export function useMemoTemplates(options: { flush: () => Promise<boolean> }) {
  const loading = ref(false)
  const selecting = ref(false)
  const busy = ref(false)
  const error = ref('')
  const templates = ref<MemoTemplateSummary[]>([])
  const selected = ref<MemoTemplate | null>(null)
  // 이전 미리보기를 유지해도 새 선택의 응답 확인 전에는 변경할 수 없다.
  const selectedReady = ref(false)
  const name = ref('')
  const confirming = ref(false)
  const created = ref<Memo | null>(null)
  let selection = 0
  const lifetime = useTemplateScope(() => {
    ++selection
    loading.value = selecting.value = busy.value = confirming.value = false
    templates.value = []
    selectedReady.value = false
    selected.value = created.value = null
    name.value = error.value = ''
  })

  async function show() {
    if (busy.value) return
    const token = lifetime.begin(true)
    if (!lifetime.current(token)) return
    ++selection
    error.value = ''
    confirming.value = selecting.value = selectedReady.value = false
    loading.value = true
    try {
      const list = await $fetch<MemoTemplateSummary[]>('/api/templates')
      if (!lifetime.current(token)) return
      templates.value = list
      const previous = selected.value?.id
      const target = list.find(item => item.id === previous) ?? list[0]
      if (target) await select(target.id, target.id === previous)
      else { selected.value = null; name.value = ''; selectedReady.value = false }
    } catch (e) {
      if (lifetime.current(token)) error.value = apiMessage(e, '템플릿 목록을 불러오지 못했습니다.')
    } finally {
      if (lifetime.current(token)) loading.value = false
    }
  }

  async function select(id: string, preserveCreated = false) {
    if (busy.value || !lifetime.current() || !templates.value.some(item => item.id === id)) return
    const token = lifetime.token()
    const chosen = ++selection
    if (!preserveCreated) created.value = null
    selectedReady.value = false
    error.value = ''
    confirming.value = false
    selecting.value = true
    try {
      const detail = await $fetch<MemoTemplate>(`/api/templates/${encodeURIComponent(id)}`)
      if (lifetime.current(token) && chosen === selection) {
        selected.value = detail
        name.value = detail.name
        selectedReady.value = true
      }
    } catch (e) {
      if (lifetime.current(token) && chosen === selection) error.value = apiMessage(e, '템플릿을 불러오지 못했습니다. 목록에서 다시 선택하세요.')
    } finally {
      if (lifetime.current(token) && chosen === selection) selecting.value = false
    }
  }

  async function rename() {
    const item = selected.value
    const next = name.value.trim()
    if (!item || !selectedReady.value || loading.value || selecting.value || busy.value || !lifetime.current() || !next || next.length > 200 || next === item.name) return
    const token = lifetime.token()
    busy.value = true
    error.value = ''
    try {
      const updated = await $fetch<MemoTemplateSummary>(`/api/templates/${encodeURIComponent(item.id)}`, { method: 'PATCH', body: { name: next } })
      if (!lifetime.current(token)) return
      templates.value = templates.value.map(entry => entry.id === item.id ? updated : entry)
      selected.value = { ...item, ...updated }
      name.value = updated.name
    } catch (e) {
      if (lifetime.current(token)) error.value = apiMessage(e, '이름 변경 결과를 확인하지 못했습니다. 목록을 다시 불러와 확인하세요.')
    } finally {
      if (lifetime.current(token)) busy.value = false
    }
  }

  async function remove() {
    const item = selected.value
    if (!item || !selectedReady.value || loading.value || selecting.value || busy.value || !confirming.value || !lifetime.current()) return
    const token = lifetime.token()
    busy.value = true
    error.value = ''
    try {
      await $fetch(`/api/templates/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      if (!lifetime.current(token)) return
      templates.value = templates.value.filter(entry => entry.id !== item.id)
      selected.value = null
      selectedReady.value = false
      name.value = ''
      confirming.value = false
    } catch (e) {
      if (lifetime.current(token)) error.value = apiMessage(e, '삭제 결과를 확인하지 못했습니다. 목록을 다시 불러와 확인하세요.')
    } finally {
      if (lifetime.current(token)) busy.value = false
    }
  }

  async function create(folder: string) {
    const item = selected.value
    if (!item || !selectedReady.value || loading.value || selecting.value || busy.value || created.value || !lifetime.current()) return null
    const token = lifetime.token()
    busy.value = true
    error.value = ''
    confirming.value = false
    try {
      if (!(await options.flush())) {
        if (lifetime.current(token)) error.value = '현재 메모를 저장하지 못해 새 메모를 만들지 않았습니다.'
        return null
      }
      if (!lifetime.current(token)) return null
      const memo = await $fetch<Memo>(`/api/templates/${encodeURIComponent(item.id)}/memos`, { method: 'POST', body: { folder } })
      if (!lifetime.current(token)) return null
      created.value = memo
      return memo
    } catch (e) {
      if (lifetime.current(token)) error.value = apiMessage(e, '생성 결과를 확인하지 못했습니다. 메모 목록에 이미 만들어졌는지 확인한 뒤 다시 시도하세요.')
      return null
    } finally {
      if (lifetime.current(token)) busy.value = false
    }
  }

  return { ...lifetime, loading, selecting, busy, error, templates, selected, selectedReady, name, confirming, created, show, select, rename, remove, create }
}

interface SaveOptions {
  memoId: () => string
  version: () => string
  flush: () => Promise<boolean>
  title: () => string
}

export function useSaveMemoTemplate(options: SaveOptions) {
  const name = ref('')
  const busy = ref(false)
  const error = ref('')
  let sourceId = ''
  const lifetime = useTemplateScope(() => {
    name.value = error.value = sourceId = ''
    busy.value = false
  })
  // 원본 문서 전환은 외부 사건이다. 첫 저장의 경로 ID 승격만 같은 원본으로 허용한다.
  watch(options.memoId, (id) => {
    if (lifetime.current() && id !== sourceId && !(busy.value && sourceId.startsWith('p:') && isUlid(id))) lifetime.close()
  }, { flush: 'sync' })
  function show() {
    if (busy.value) return
    lifetime.begin()
    if (!lifetime.current()) return
    sourceId = options.memoId()
    name.value = (options.title().trim() || '내 템플릿').slice(0, 200)
  }
  async function save() {
    const next = name.value.trim()
    if (busy.value || !lifetime.current() || !next || next.length > 200) return false
    const token = lifetime.token()
    busy.value = true
    error.value = ''
    try {
      if (options.memoId() !== sourceId) {
        error.value = '열린 메모가 바뀌었습니다. 템플릿 저장을 다시 여세요.'
        return false
      }
      if (!(await options.flush())) {
        if (lifetime.current(token)) error.value = '현재 메모를 저장하지 못해 템플릿을 만들지 않았습니다.'
        return false
      }
      if (!lifetime.current(token)) return false
      // 외부 파일의 첫 저장에서 p: 경로가 영구 ID로 바뀐다. 저장 뒤 버전을 사용한다.
      const memoId = options.memoId()
      if (memoId !== sourceId && !(sourceId.startsWith('p:') && isUlid(memoId))) {
        error.value = '열린 메모가 바뀌었습니다. 템플릿 저장을 다시 여세요.'
        return false
      }
      sourceId = memoId
      await $fetch<MemoTemplateSummary>('/api/templates', { method: 'POST', body: { memoId, name: next, baseVersion: options.version() } })
      if (!lifetime.current(token)) return false
      lifetime.close()
      return true
    } catch (e) {
      if (lifetime.current(token)) error.value = apiStatus(e) === 409
        ? '메모가 다른 곳에서 수정되었습니다. 현재 메모를 확인한 뒤 다시 저장하세요.'
        : apiMessage(e, '저장 결과를 확인하지 못했습니다. 내 템플릿 목록을 먼저 확인한 뒤 다시 시도하세요.')
      return false
    } finally {
      if (lifetime.current(token)) busy.value = false
    }
  }
  return { ...lifetime, name, busy, error, show, save }
}
