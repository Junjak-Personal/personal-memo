/**
 * 자동저장 (설계문서 §7.2).
 *
 * - 입력이 멈추고 1초 뒤 저장. 저장 중에 또 바뀌면 끝난 뒤 한 번 더. (제목은 5초 — MemoDocument)
 * - 409 → 「다른 곳에서 수정됨」. 조용히 덮어쓰지 않는다 — 다시 불러오기 / 덮어쓰기를 사람이 고른다.
 * - 처음 저장하기 전에 왕복 검사: 이 앱이 저장하면 형식이 바뀌는 파일(밖에서 쓴 각주·HTML 블록 등)이면
 *   저장을 멈추고 확인을 받는다 (§7.1).
 * - 「저장됨」은 서버 응답을 받은 뒤에만.
 * - 오프라인 보호: 보내기 전에 이 기기에 보관하고(memo-drafts), 서버가 받으면 지운다. 닿지 못하면 「기기에 보관」으로 두고
 *   연결이 돌아오면(online 이벤트, 30초마다) 다시 보낸다.
 *
 * watch 로 입력을 따라가지 않는다 — 화면이 changed() 를 직접 부른다.
 */
import type { Memo, MemoInput } from '#shared/types/memo'
import { canonicalHtmlTables } from '~/utils/canonical-table-html'
import { isNetworkError, markDraftConflict, type MemoDraft, notifyMemoSaved, readDraft, removeSavedDraft, writeDraft } from '~/utils/memo-drafts'

export type SaveState =
  | { status: 'saved' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'error'; message: string }
  /** 서버에 닿지 못했다 — 이 기기에 보관해 두고 연결을 기다린다 */
  | { status: 'offline' }
  | { status: 'conflict'; version: string }
  | { status: 'format' }

const DELAY_MS = 1000
/** 오프라인일 때 다시 보내 보는 간격 — online 이벤트를 놓쳐도 이걸로 맞춘다 */
const OFFLINE_RETRY_MS = 30_000
const REQUEST_TIMEOUT_MS = 15_000

/**
 * 모양만 다른 차이를 걷어낸다 — 경고는 «뜻이 바뀌는» 차이에만 의미가 있다. 걷어내는 것:
 * - 표 칸 정렬 공백, 표 구분선의 대시 개수 (`| --- |` ↔ `| ----------- |`)
 * - 문단 사이의 여분 빈 줄과 의미 없는 줄 끝 공백
 * - 코드 밖 기호 이스케이프 (`S1~S6` ↔ `S1\~S6`)
 * 목록 깊이·코드 공백·hard break는 내용이므로 그대로 비교한다.
 *
 * 🔴 대괄호·꺾쇠 이스케이프는 남긴다. 각주 `[^1]` 가 `\[^1\]` 로 바뀌면 각주를 아는 도구(GitHub)에서
 *    뜻이 깨진다 — 그게 이 검사가 잡으려는 바로 그 손실이다.
 */
export function canonicalMarkdown(markdown: string) {
  const lines = canonicalHtmlTables(markdown).split('\n')
  const normalized: string[] = []
  let fence: { marker: string; length: number } | null = null
  let table = false
  const separator = (line: string) => /^[\s|:-]+$/.test(line) && line.includes('-') && line.includes('|')
  for (const [index, line] of lines.entries()) {
    const marker = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
    if (marker) {
      const token = marker[1]!
      if (!fence) fence = { marker: token[0]!, length: token.length }
      else if (token[0] === fence.marker && token.length >= fence.length && !marker[2]!.trim()) fence = null
      normalized.push(line)
      table = false
      continue
    }
    // 코드의 들여쓰기·공백·빈 줄은 내용이다. 깊은 목록의 들여쓰기도 합치지 않는다.
    if (fence || /^(?: {4}|\t)/.test(line)) { normalized.push(line); continue }
    if (!line.trim()) {
      if (normalized.at(-1) !== '') normalized.push('')
      table = false
      continue
    }
    const leading = /^[ \t]*/.exec(line)![0]
    let body = line.slice(leading.length).trimEnd()
    table = body.includes('|') && (table || separator(lines[index + 1] ?? '') || separator(body))
    if (table) body = body.replace(/[ \t]+/g, ' ')
    if (separator(body)) body = body.replace(/-+/g, '---')
    // inline code 안의 역슬래시도 문자 그대로 보존한다.
    if (!body.includes('`')) body = body.replace(/\\([!"#$%&'()*+,\-./:;=?@\\^_`{|}~])/g, '$1')
    const hardBreak = !table && / {2,}$/.test(line) && !!lines[index + 1]?.trim()
    normalized.push(leading + body + (hardBreak ? '  ' : ''))
  }
  while (normalized[0] === '') normalized.shift()
  while (normalized.at(-1) === '') normalized.pop()
  return normalized.join('\n')
}

export function shouldSaveMarkdown(value: string, current: string, initialBaseline: string | null): boolean {
  const canonical = canonicalMarkdown(value)
  if (canonical === canonicalMarkdown(current)) return false
  // 최초 에디터 왕복 정규화만 무시한다. 이후 원문으로 되돌리는 undo는 다시 저장해야 한다.
  if (initialBaseline !== null && canonical === canonicalMarkdown(initialBaseline)) return false
  return true
}

interface Options {
  memo: Memo
  /** 지금 화면의 제목·본문·날짜·태그 */
  read: () => Required<MemoInput>
  /** 에디터로 한 번 읽고 다시 쓴 마크다운 — 왕복 검사용 */
  normalize: (markdown: string) => string
  formatEquivalent?: (source: string, roundTrip: string) => boolean
  /** 저장 성공 뒤. id 나 제목이 바뀌었으면 화면이 트리·주소를 맞춘다 */
  onSaved: (saved: Memo, previous: Memo) => void
}

export function useMemoAutosave(options: Options) {
  const state = ref<SaveState>({ status: 'saved' })
  const draftStored = ref(true)

  let id = options.memo.id
  let version = options.memo.version
  let last = options.memo
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<boolean> | null = null
  let editRevision = 0
  let disposed = false
  let paused = false
  let formatChecked = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const busy = computed(() => state.value.status === 'conflict' || state.value.status === 'format')

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  /** 화면이 고칠 때마다 부른다 */
  function changed() {
    editRevision++
    if (paused) return
    preserveDraft()
    if (busy.value) return
    state.value = { status: 'dirty' }
    clearTimer()
    timer = setTimeout(() => void save(), DELAY_MS)
  }

  function preserveDraft(patch: Partial<MemoInput> = {}) {
    if (paused) return draftStored.value
    const draft: MemoDraft = { id, baseVersion: version, input: { ...options.read(), ...patch }, savedAt: new Date().toISOString(), ...(state.value.status === 'conflict' ? { conflict: true } : {}), ...(!formatChecked ? { review: state.value.status === 'format' ? 'format' as const : 'pending' as const } : {}) }
    draftStored.value = writeDraft(draft)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('memo-drafts-changed'))
    return draftStored.value
  }

  function save(baseVersion = version): Promise<boolean> {
    clearTimer()
    if (paused) return Promise.resolve(state.value.status === 'saved')
    if (inflight) return inflight
    const run = async () => {
      if (!formatChecked) {
        const original = options.memo.content
        const roundTrip = options.normalize(original)
        if (canonicalMarkdown(roundTrip) !== canonicalMarkdown(original) && !options.formatEquivalent?.(original, roundTrip)) {
          state.value = { status: 'format' }
          preserveDraft()
          return false
        }
        formatChecked = true
      }
      let nextVersion = baseVersion
      for (;;) {
        const requestedRevision = editRevision
        if (!(await request(nextVersion, requestedRevision))) return false
        if (editRevision === requestedRevision) return true
        clearTimer()
        nextVersion = version
      }
    }
    const result = Promise.resolve().then(run).finally(() => { if (inflight === result) inflight = null })
    inflight = result
    return result
  }

  async function request(baseVersion: string, requestedRevision: number) {
    state.value = { status: 'saving' }
    const draft: MemoDraft = { id, baseVersion, input: options.read(), savedAt: new Date().toISOString() }
    // 보내기 전에 보관한다 — 응답을 기다리는 사이에 앱이 꺼져도 남도록
    draftStored.value = writeDraft(draft)
    try {
      const saved = await $fetch<Memo>(`/api/memos/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { ...draft.input, baseVersion },
        timeout: REQUEST_TIMEOUT_MS,
      })
      const previous = last
      removeSavedDraft(draft)
      id = saved.id
      version = saved.version
      last = saved
      stopRetry()
      state.value = editRevision !== requestedRevision ? { status: 'dirty' } : { status: 'saved' }
      if (editRevision !== requestedRevision) preserveDraft()
      notifyMemoSaved()
      if (!disposed) options.onSaved(saved, previous)
      return true
    } catch (e) {
      const data = apiData(e)
      if (apiStatus(e) === 409 && data.version) {
        // 사람이 고를 때까지 보관함이 대신 저장하지 않게 표시한다
        state.value = { status: 'conflict', version: data.version }
        const stored = readDraft(id)
        if (stored && !stored.source && stored.baseVersion === baseVersion && JSON.stringify(stored.input) === JSON.stringify(options.read())) markDraftConflict(stored)
      } else if (isNetworkError(e)) {
        state.value = { status: 'offline' }
        if (!disposed) waitForConnection()
      } else {
        state.value = { status: 'error', message: apiMessage(e, '저장하지 못했습니다') }
      }
      return false
    }
  }

  function onOnline() {
    if (state.value.status === 'offline') void save()
  }

  /** 연결이 돌아오면 다시 보낸다. online 이벤트를 못 받는 경우를 위해 주기적으로도 해 본다 */
  function waitForConnection() {
    window.removeEventListener('online', onOnline)
    window.addEventListener('online', onOnline, { once: true })
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(onOnline, OFFLINE_RETRY_MS)
  }

  function stopRetry() {
    window.removeEventListener('online', onOnline)
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }

  /** 나가기·숨김·이동·삭제 전에 — 고친 게 남아 있으면 지금 저장한다 */
  async function flush() {
    if (inflight) return inflight
    if (state.value.status === 'saved') return true
    if (busy.value) return false
    return save()
  }

  /** 충돌 — 서버의 내용으로 되돌린다. 화면은 돌려받은 메모로 입력칸을 다시 채운다. 보관해 둔 수정은 버린다 */
  async function reload() {
    const requestedRevision = editRevision
    const stored = readDraft(id)
    const fresh = await $fetch<Memo>(`/api/memos/${encodeURIComponent(id)}`, { timeout: REQUEST_TIMEOUT_MS })
    if (editRevision !== requestedRevision) throw new Error('불러오는 동안 입력이 바뀌었습니다. 다시 시도하세요.')
    if (stored) removeSavedDraft(stored)
    version = fresh.version
    last = fresh
    state.value = { status: 'saved' }
    return fresh
  }

  /** 충돌 — 내 내용으로 덮어쓴다 */
  function overwrite() {
    if (state.value.status !== 'conflict') return Promise.resolve(false)
    const theirs = state.value.version
    version = theirs
    state.value = { status: 'dirty' }
    return save(theirs)
  }

  /** 형식 바뀜을 받아들이고 저장을 이어간다 */
  function acceptFormat() {
    formatChecked = true
    state.value = { status: 'dirty' }
    return save()
  }

  onBeforeUnmount(() => {
    disposed = true
    clearTimer()
    stopRetry()
  })

  /** 이 기기에 보관된, 아직 서버에 없는 수정 (열 때 되살리기 판단용) */
  function pendingDraft() {
    return readDraft(id)
  }

  function pause() { paused = true; clearTimer(); stopRetry() }
  function resume() { paused = false; if (!disposed && state.value.status === 'offline') waitForConnection() }

  return { state, draftStored, changed, save, flush, reload, overwrite, acceptFormat, pendingDraft, preserveDraft, pause, resume, currentId: () => id, currentVersion: () => version }
}
