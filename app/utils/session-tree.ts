import type { TreeResponse } from '#shared/types/memo'

interface SessionTreeOptions {
  scope: () => string | null
  tree: () => TreeResponse | null
  setTree: (tree: TreeResponse | null) => void
  setError: (error: string | null) => void
  fetch: () => Promise<TreeResponse>
  message: (error: unknown) => string
}

type TreeOutcome = { kind: 'changed' } | { kind: 'ready'; tree: TreeResponse } | { kind: 'failed'; error: unknown }

/** 요청을 시작한 로그인과 최신 갱신만 결과를 사용할 수 있다. */
class SupersededTreeRequest extends Error {
  constructor() { super('목록 요청의 세션 또는 갱신이 바뀌었습니다') }
}

/** 앱 메모리에만 둔다. 서버 캐시·유효 시간 없이 첫 조회와 명시적 갱신을 구분한다. */
export function createSessionTree(options: SessionTreeOptions) {
  let scope = options.scope()
  let sessionRevision = 0
  let revision = 0
  let valid = false
  let pending: Promise<TreeResponse> | null = null
  let latest: Promise<TreeResponse> | null = null
  const waiting = new Set<() => void>()
  options.setTree(null)
  options.setError(null)

  function syncScope() {
    const next = options.scope()
    if (next === scope) return
    scope = next
    sessionRevision++
    revision++
    valid = false
    pending = null
    latest = null
    options.setTree(null)
    options.setError(null)
    for (const changed of waiting) changed()
  }

  function request(): Promise<TreeResponse> {
    const requestedScope = scope
    if (!requestedScope) return Promise.reject(new SupersededTreeRequest())
    const requestedRevision = ++revision
    valid = false
    const current = () => requestedScope === scope && requestedRevision === revision
    const result = Promise.resolve().then(() => {
      syncScope()
      if (!current()) throw new SupersededTreeRequest()
      return options.fetch()
    }).then((tree) => {
      syncScope()
      if (!current()) throw new SupersededTreeRequest()
      options.setTree(tree)
      options.setError(null)
      valid = true
      return tree
    }, (error: unknown) => {
      syncScope()
      if (!current()) throw new SupersededTreeRequest()
      options.setError(options.message(error))
      throw error
    }).finally(() => {
      if (pending === result) pending = null
    })
    pending = result
    latest = result
    for (const changed of waiting) changed()
    return result
  }

  function observe(request: Promise<TreeResponse>): Promise<TreeOutcome> {
    return new Promise((resolve) => {
      let finished = false
      const changed = () => finish({ kind: 'changed' })
      const finish = (outcome: TreeOutcome) => {
        if (finished) return
        finished = true
        waiting.delete(changed)
        resolve(outcome)
      }
      waiting.add(changed)
      void request.then((tree) => finish({ kind: 'ready', tree }), (error: unknown) => finish({ kind: 'failed', error }))
    })
  }

  function ensure(): Promise<TreeResponse> {
    syncScope()
    if (pending) return pending
    const tree = options.tree()
    if (scope && valid && tree) return Promise.resolve(tree)
    return request()
  }

  /** 시작 화면은 같은 로그인에서 새로 요청한 목록의 완료까지 기다린다. */
  async function settled(): Promise<TreeResponse> {
    syncScope()
    const requestedScope = scope
    const requestedSession = sessionRevision
    if (!requestedScope) throw new SupersededTreeRequest()
    // 첫 조회만 시작한다. 최근 실패도 기억해서 이 대기 함수가 재시도를 만들지 않게 한다.
    if (!latest) ensure()
    while (latest) {
      const request = latest
      const outcome = await observe(request)
      syncScope()
      if (scope !== requestedScope || sessionRevision !== requestedSession) throw new SupersededTreeRequest()
      if (latest !== request || outcome.kind === 'changed') continue
      if (outcome.kind === 'failed') throw outcome.error
      return options.tree() ?? outcome.tree
    }
    throw new SupersededTreeRequest()
  }

  async function refresh() {
    syncScope()
    // 저장 뒤의 갱신은 이전 조회에 합류하지 않는다. 늦은 조회가 새 결과를 덮는 것도 막는다.
    try { await request() } catch { /* 오류는 상태로 보여 준다. 기존 호출부의 실패 처리 방식 유지 */ }
  }

  return { ensure, settled, refresh, syncScope }
}
