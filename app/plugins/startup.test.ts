import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { StartupPhase } from '~/utils/startup-loading'

interface HarnessApp {
  hook: (name: string, callback: () => void) => void
  vueApp: { onUnmount: (callback: () => void) => void }
  $router: { currentRoute: Ref<{ path: string; params: { id?: string }; meta: { layout?: false } }> }
}
interface StartupPlugin {
  setup: (app: HarnessApp) => { provide: { startup: { memoReady: (id: string) => void; reveal: () => void } } }
}

describe('초기 준비 플러그인과 optional native 신호', () => {
  let hooks: Map<string, () => void>
  let cleanup: Array<() => void>
  let phase: Ref<StartupPhase>
  let session: Ref<{ id: string; user: { owner: boolean }; loggedInAt: number } | null>
  let route: HarnessApp['$router']['currentRoute']
  let frames: Map<number, FrameRequestCallback>
  let ensure: ReturnType<typeof vi.fn<() => Promise<void>>>
  let settle: () => void
  let post: ReturnType<typeof vi.fn>
  let startup: ReturnType<StartupPlugin['setup']>['provide']['startup']

  async function event(name: string) {
    hooks.get(name)?.()
    await Promise.resolve()
    await Promise.resolve()
  }
  function paint() {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(0)
  }
  beforeEach(async () => {
    vi.useFakeTimers()
    hooks = new Map()
    cleanup = []
    phase = ref('loading')
    session = ref({ id: 'session-one', user: { owner: true }, loggedInAt: 100 })
    route = ref({ path: '/m/one', params: { id: 'one' }, meta: {} })
    frames = new Map()
    let frame = 0
    ensure = vi.fn(() => new Promise<void>((done) => { settle = done }))
    post = vi.fn()
    vi.stubGlobal('window', { setTimeout, MemoStartup: { postMessage: post } })
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    vi.stubGlobal('location', { origin: 'https://memo.test' })
    vi.stubGlobal('defineNuxtPlugin', (plugin: StartupPlugin) => plugin)
    vi.stubGlobal('useState', (key: string) => key === 'startup-phase' ? phase : ref(0))
    vi.stubGlobal('useUserSession', () => ({ session }))
    vi.stubGlobal('useMemoTree', () => ({ ensure, settled: ensure }))
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    const plugin = (await import('./startup.client')).default as unknown as StartupPlugin
    startup = plugin.setup({ hook: (name, callback) => hooks.set(name, callback), vueApp: { onUnmount: callback => cleanup.push(callback) }, $router: { currentRoute: route } }).provide.startup
  })
  afterEach(() => {
    for (const callback of cleanup) callback()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('tree·page·editor 준비 뒤만 현재 상태를 먼저 공개하고 native에 한 번 알린다', async () => {
    await event('app:created')
    await event('app:mounted')
    await event('page:finish')
    settle()
    await event('unused')
    paint()
    expect(window.memoStartup?.ready).toBe(false)
    startup.memoReady('one')
    paint()
    expect(phase.value).toBe('ready')
    expect(window.memoStartup).toMatchObject({ ready: true, failed: false })
    expect(post).toHaveBeenCalledExactlyOnceWith('{"type":"ready"}')
    await event('page:start')
    route.value = { path: '/m/two', params: { id: 'two' }, meta: {} }
    await event('page:finish')
    expect(phase.value).toBe('ready')
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('15초는 지연 안내만 표시하고 수동 웹 보기도 ready를 위조하지 않는다', async () => {
    await event('app:created')
    await vi.advanceTimersByTimeAsync(15000)
    expect(phase.value).toBe('slow')
    expect(post).not.toHaveBeenCalled()
    startup.reveal()
    expect(phase.value).toBe('revealed')
    expect(window.memoStartup?.ready).toBe(false)
  })
  it('초기 오류는 failed를 보내고 대기하던 완료 이벤트로 덮지 않는다', async () => {
    await event('app:created')
    await event('app:error')
    expect(phase.value).toBe('failed')
    expect(window.memoStartup).toMatchObject({ ready: false, failed: true })
    settle()
    await event('app:mounted')
    await event('page:finish')
    startup.memoReady('one')
    paint()
    expect(post).toHaveBeenCalledExactlyOnceWith('{"type":"error"}')
  })
  it('로그인 화면과 native 채널 없는 구버전·일반 웹도 tree 없이 완료한다', async () => {
    session.value = null
    delete window.MemoStartup
    route.value = { path: '/login', params: {}, meta: { layout: false } }
    await event('app:created')
    await event('app:mounted')
    await event('page:finish')
    paint()
    expect(ensure).not.toHaveBeenCalled()
    expect(window.memoStartup?.ready).toBe(true)
  })
  it('paint 직전 세션이 바뀌면 이전 tree 응답으로 닫지 않는다', async () => {
    await event('app:created')
    const first = settle
    await event('app:mounted')
    await event('page:finish')
    startup.memoReady('one')
    first()
    await event('unused')
    session.value = { id: 'session-two', user: { owner: true }, loggedInAt: 200 }
    paint()
    expect(window.memoStartup?.ready).toBe(false)
    settle()
    await event('unused')
    paint()
    expect(window.memoStartup?.ready).toBe(true)
  })
  it('기존 MemoNative만 있는 설치 앱에서도 준비를 마치며 툴바 채널에 새 메시지를 보내지 않는다', async () => {
    const toolbar = vi.fn()
    Object.assign(window, { MemoNative: { postMessage: toolbar } })
    delete window.MemoStartup
    await event('app:created')
    await event('app:mounted')
    await event('page:finish')
    settle()
    await event('unused')
    startup.memoReady('one')
    paint()
    expect(window.memoStartup?.ready).toBe(true)
    expect(phase.value).toBe('ready')
    expect(toolbar).not.toHaveBeenCalled()
  })
})
