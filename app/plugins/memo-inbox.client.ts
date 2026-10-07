/**
 * 공유 시트 보관함 → 「받은 메모」 폴더 (설계문서 §10.4, 2026-10-07 확정 — 「앱 열 때 저장」).
 *
 * 폰 껍데기 안에서만 돈다(window.MemoInbox 채널이 있을 때). 공유 확장은 서버에 닿지 않고 App Group 보관함에 넣기만 한다.
 * 웹이 로그인돼 있을 때 꺼내 달라고(pull) 하면 껍데기가 deliver(items) 로 넘겨주고, 웹은 새 메모로 저장한 것만
 * ack 로 알린다 — 껍데기는 그것만 보관함에서 뺀다. 저장 도중 앱이 꺼져도 남은 것은 다음에 다시 온다.
 *
 * 시점: 앱이 뜬 뒤, 로그인 직후, 앱이 다시 보일 때(공유 시트에서 돌아올 때 껍데기도 알려 준다).
 */
import type { Memo } from '#shared/types/memo'
import { INBOX_FOLDER, type InboxItem, isInboxItem, memoFromShare } from '~/utils/share-inbox'

declare global {
  interface Window {
    /** 껍데기가 심는 채널 (app-ios/lib/main.dart 의 kInboxChannel) */
    MemoInbox?: { postMessage: (message: string) => void }
    /** 껍데기가 부르는 쪽 */
    memoInbox?: { deliver: (items: unknown) => Promise<void>; pull: () => void }
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const channel = window.MemoInbox
  if (!channel) return

  const router = useRouter()
  const toast = useToast()
  const { loggedIn } = useUserSession()
  const { refresh } = useMemoTree()
  /** 이번 실행에서 이미 저장한 것 — ack 가 껍데기에 닿기 전에 같은 것이 또 와도 두 번 만들지 않는다 */
  const done = new Set<string>()
  let delivering = false

  function pull() {
    if (loggedIn.value) channel?.postMessage(JSON.stringify({ type: 'pull' }))
  }

  async function ensureFolder() {
    try {
      await $fetch('/api/folders', { method: 'POST', body: { parent: '', name: INBOX_FOLDER } })
    } catch (e) {
      // 이미 있다
      if (apiStatus(e) !== 409) throw e
    }
  }

  async function deliver(raw: unknown) {
    if (!loggedIn.value || delivering || !Array.isArray(raw)) return
    const items = raw.filter((i): i is InboxItem => isInboxItem(i) && !done.has(i.id))
    if (!items.length) return
    delivering = true
    const saved: string[] = []
    let last: Memo | null = null
    try {
      await ensureFolder()
      for (const item of items) {
        last = await $fetch<Memo>('/api/memos', { method: 'POST', body: { folder: INBOX_FOLDER, ...memoFromShare(item) } })
        saved.push(item.id)
        done.add(item.id)
      }
    } catch (e) {
      // 나머지는 보관함에 남는다 — 다음에 다시 온다
      toast.add({ color: 'error', title: apiMessage(e, '공유로 받은 메모를 저장하지 못했습니다'), description: '보관함에 남겨 두었습니다.' })
    } finally {
      delivering = false
      if (saved.length) channel?.postMessage(JSON.stringify({ type: 'ack', ids: saved }))
    }
    if (!saved.length) return
    await refresh()
    const opened = last
    toast.add({
      title: `공유로 받은 메모 ${saved.length}개를 「${INBOX_FOLDER}」에 저장했습니다`,
      actions: opened ? [{ label: '열기', color: 'neutral', variant: 'outline', onClick: () => void navigateTo(memoPath(opened.id)) }] : [],
    })
  }

  window.memoInbox = { deliver, pull }
  nuxtApp.hook('app:mounted', pull)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull()
  })
  router.afterEach((_to, from) => {
    if (from.path === '/login') pull()
  })
})
