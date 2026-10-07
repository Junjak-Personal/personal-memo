/**
 * 자동저장 (설계문서 §7.2).
 *
 * - 입력이 멈추고 1초 뒤 저장. 저장 중에 또 바뀌면 끝난 뒤 한 번 더. (제목은 5초 — MemoDocument)
 * - 409 → 「다른 곳에서 수정됨」. 조용히 덮어쓰지 않는다 — 다시 불러오기 / 덮어쓰기를 사람이 고른다.
 * - 처음 저장하기 전에 왕복 검사: 이 앱이 저장하면 형식이 바뀌는 파일(밖에서 쓴 각주·HTML 블록 등)이면
 *   저장을 멈추고 확인을 받는다 (§7.1).
 * - 「저장됨」은 서버 응답을 받은 뒤에만.
 *
 * watch 로 입력을 따라가지 않는다 — 화면이 changed() 를 직접 부른다.
 */
import type { Memo, MemoInput } from '#shared/types/memo'

export type SaveState =
  | { status: 'saved' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'error'; message: string }
  | { status: 'conflict'; version: string }
  | { status: 'format' }

const DELAY_MS = 1000

/**
 * 모양만 다른 차이를 걷어낸다 — 경고는 «뜻이 바뀌는» 차이에만 의미가 있다. 걷어내는 것:
 * - 표 칸 정렬 공백, 표 구분선의 대시 개수 (`| --- |` ↔ `| ----------- |`)
 * - 줄 끝 공백, 빈 줄 개수
 * - 기호 이스케이프 (`S1~S6` ↔ `S1\~S6`) — 마크다운에서 같은 글자로 보인다
 *
 * 🔴 대괄호·꺾쇠 이스케이프는 남긴다. 각주 `[^1]` 가 `\[^1\]` 로 바뀌면 각주를 아는 도구(GitHub)에서
 *    뜻이 깨진다 — 그게 이 검사가 잡으려는 바로 그 손실이다.
 */
export function canonicalMarkdown(markdown: string) {
  return markdown
    .split('\n')
    .map((line) => {
      const spaced = line.replace(/[ \t]+/g, ' ').trimEnd()
      const separator = /^[\s|:-]+$/.test(spaced) && spaced.includes('-')
      return (separator ? spaced.replace(/-+/g, '---') : spaced).replace(/\\([!"#$%&'()*+,\-./:;=?@\\^_`{|}~])/g, '$1')
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

interface Options {
  memo: Memo
  /** 지금 화면의 제목·본문·날짜 */
  read: () => MemoInput
  /** 에디터로 한 번 읽고 다시 쓴 마크다운 — 왕복 검사용 */
  normalize: (markdown: string) => string
  /** 저장 성공 뒤. id 나 제목이 바뀌었으면 화면이 트리·주소를 맞춘다 */
  onSaved: (saved: Memo, previous: Memo) => void
}

export function useMemoAutosave(options: Options) {
  const state = ref<SaveState>({ status: 'saved' })

  let id = options.memo.id
  let version = options.memo.version
  let last = options.memo
  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<boolean> | null = null
  let again = false
  let formatChecked = false

  const busy = computed(() => state.value.status === 'conflict' || state.value.status === 'format')

  function clearTimer() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  /** 화면이 고칠 때마다 부른다 */
  function changed() {
    if (busy.value) return
    state.value = { status: 'dirty' }
    clearTimer()
    timer = setTimeout(() => void save(), DELAY_MS)
  }

  async function save(baseVersion = version): Promise<boolean> {
    clearTimer()
    if (inflight) {
      again = true
      return inflight
    }
    if (!formatChecked) {
      const original = options.memo.content
      if (canonicalMarkdown(options.normalize(original)) !== canonicalMarkdown(original)) {
        state.value = { status: 'format' }
        return false
      }
      formatChecked = true
    }
    inflight = request(baseVersion)
    const ok = await inflight
    inflight = null
    if (ok && again) {
      again = false
      return save()
    }
    again = false
    return ok
  }

  async function request(baseVersion: string) {
    state.value = { status: 'saving' }
    try {
      const saved = await $fetch<Memo>(`/api/memos/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { ...options.read(), baseVersion },
      })
      const previous = last
      id = saved.id
      version = saved.version
      last = saved
      state.value = again ? { status: 'dirty' } : { status: 'saved' }
      options.onSaved(saved, previous)
      return true
    } catch (e) {
      const data = apiData(e)
      state.value =
        apiStatus(e) === 409 && data.version
          ? { status: 'conflict', version: data.version }
          : { status: 'error', message: apiMessage(e, '저장하지 못했습니다') }
      return false
    }
  }

  /** 나가기·숨김·이동·삭제 전에 — 고친 게 남아 있으면 지금 저장한다 */
  async function flush() {
    if (state.value.status === 'saved') return true
    if (busy.value) return false
    return save()
  }

  /** 충돌 — 서버의 내용으로 되돌린다. 화면은 돌려받은 메모로 입력칸을 다시 채운다 */
  async function reload() {
    const fresh = await $fetch<Memo>(`/api/memos/${encodeURIComponent(id)}`)
    version = fresh.version
    last = fresh
    state.value = { status: 'saved' }
    return fresh
  }

  /** 충돌 — 내 내용으로 덮어쓴다 */
  function overwrite() {
    if (state.value.status !== 'conflict') return Promise.resolve(false)
    const theirs = state.value.version
    state.value = { status: 'dirty' }
    return save(theirs)
  }

  /** 형식 바뀜을 받아들이고 저장을 이어간다 */
  function acceptFormat() {
    formatChecked = true
    state.value = { status: 'dirty' }
    return save()
  }

  onBeforeUnmount(clearTimer)

  return { state, changed, save, flush, reload, overwrite, acceptFormat, currentId: () => id }
}
