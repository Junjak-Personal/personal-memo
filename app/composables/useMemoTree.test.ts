import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { TreeResponse } from '#shared/types/memo'
import { useMemoTree } from './useMemoTree'

const tree: TreeResponse = { folders: [], memos: [], orders: {}, todoOrder: [] }

describe('Nuxt 앱에 속한 목록 공유와 인증 감시', () => {
  const cleanups: Array<() => void> = []
  let state: Map<string, Ref<unknown>>
  let app: { vueApp: { onUnmount: (cleanup: () => void) => void; runWithContext: <T>(callback: () => T) => T } }
  let session: Ref<unknown>
  let fetchTree: ReturnType<typeof vi.fn>

  function newApp() {
    state = new Map()
    app = { vueApp: { onUnmount: (cleanup) => cleanups.push(cleanup), runWithContext: callback => callback() } }
  }

  beforeEach(() => {
    newApp()
    session = ref({ id: 'one', user: { owner: true }, loggedInAt: 100 })
    fetchTree = vi.fn().mockResolvedValue(tree)
    vi.stubGlobal('useNuxtApp', () => app)
    vi.stubGlobal('useUserSession', () => ({ session }))
    vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
    vi.stubGlobal('useState', <T>(key: string, initial: () => T): Ref<T> => {
      if (!state.has(key)) state.set(key, ref(initial()))
      return state.get(key) as Ref<T>
    })
    vi.stubGlobal('effectScope', effectScope)
    vi.stubGlobal('watch', watch)
    vi.stubGlobal('$fetch', fetchTree)
    vi.stubGlobal('apiMessage', () => '목록 오류')
  })
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    vi.unstubAllGlobals()
  })

  it('여러 composable 호출에서 같은 요청과 메모리 결과를 사용한다', async () => {
    const first = useMemoTree()
    const second = useMemoTree()
    expect(first.tree).toBe(second.tree)
    const load = first.ensure()
    expect(second.ensure()).toBe(load)
    await load
    await second.ensure()
    expect(await second.settled()).toBe(first.tree.value)
    expect(fetchTree).toHaveBeenCalledTimes(1)
  })

  it('별도 호출 없이도 세션 전환 즉시 목록과 오류를 지운다', async () => {
    const first = useMemoTree()
    await first.ensure()
    session.value = { id: 'two', user: { owner: true }, loggedInAt: 200 }
    expect(first.tree.value).toBeNull()
    fetchTree.mockRejectedValue(new Error('403'))
    await first.refresh()
    expect(first.error.value).toBe('목록 오류')
    session.value = null
    expect(first.tree.value).toBeNull()
    expect(first.error.value).toBeNull()
  })

  it('다른 Nuxt 앱에는 이전 앱 목록과 진행 중인 요청을 전달하지 않는다', async () => {
    const first = useMemoTree()
    await first.ensure()
    newApp()
    const second = useMemoTree()
    expect(second.tree.value).toBeNull()
    await second.ensure()
    expect(fetchTree).toHaveBeenCalledTimes(2)
  })
})
