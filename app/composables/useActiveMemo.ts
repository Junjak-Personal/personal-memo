/**
 * 지금 열려 있는 메모 하나.
 *
 * 사이드바·메뉴가 메모를 옮기거나 폴더를 옮기고 이름을 바꿀 때:
 * 1. 열린 메모에 닿는 동작이면 고친 것을 먼저 저장하고 (flush)
 * 2. 끝난 뒤 문서 화면을 새로 세운다 (reload)
 *
 * 🔴 2 가 없으면 이미지가 깨진다. 문서 화면은 연 순간의 폴더로 이미지 주소(/api/files/<폴더>/assets/…)를
 *    만들기 때문에, 폴더가 바뀐 뒤에도 옛 주소를 계속 쓴다 (2026-10-07 발견).
 *
 * 저장 함수는 상태가 아니라서 useState 에 넣지 않고 모듈 변수로 둔다 — SPA 라 사용자 하나, 화면 하나다.
 */
interface ActiveMemo {
  id: () => string
  folder: () => string
  flush: () => Promise<boolean>
}

let active: ActiveMemo | null = null

export function useActiveMemo() {
  const tick = useState('memo-reload-tick', () => 0)

  /** 문서 화면이 setup 에서 부른다 */
  function register(memo: ActiveMemo) {
    active = memo
    onBeforeUnmount(() => {
      if (active === memo) active = null
    })
  }

  /** 이 동작이 열린 메모에 닿는가 — 그 메모 자체이거나, 그 메모가 든 폴더(또는 그 위 폴더) */
  function touches(target: { memoId: string } | { folder: string }) {
    if (!active) return false
    if ('memoId' in target) return active.id() === target.memoId
    const folder = active.folder()
    return folder === target.folder || folder.startsWith(`${target.folder}/`)
  }

  async function flush() {
    return active ? active.flush() : true
  }

  /** 이 메모가 지금 열려 있나 — 열린 메모의 보관 수정은 그 화면이 저장한다 */
  function isOpen(id: string) {
    return active?.id() === id
  }

  function reload() {
    tick.value++
  }

  return { tick, register, touches, flush, isOpen, reload }
}
