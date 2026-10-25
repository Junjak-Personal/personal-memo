import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoPath } from '~/utils/memo-path'
import { useCreateMemo } from './useCreateMemo'

async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('새 메모와 템플릿 생성 선택', () => {
  const fetch = vi.fn().mockResolvedValue({ id: 'new-id' })
  const refresh = vi.fn().mockResolvedValue(undefined)
  const apply = vi.fn().mockResolvedValue(true)
  const navigate = vi.fn().mockResolvedValue(undefined)
  const showTemplates = vi.fn<(folder: string) => Promise<void>>().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    apply.mockResolvedValue(true)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
    vi.stubGlobal('useMemoTree', () => ({ refresh }))
    vi.stubGlobal('useStructureQueue', () => ({ apply }))
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('navigateTo', navigate)
    vi.stubGlobal('memoPath', memoPath)
    vi.stubGlobal('apiMessage', (_error: Error, fallback: string) => fallback)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('선택 메뉴를 열기만 해서는 메모를 만들거나 템플릿을 조회하지 않는다', () => {
    const state = useCreateMemo()
    expect(state.creationItems('개인/일지', showTemplates).map(item => item.label)).toEqual(['새 메모로 생성', '템플릿에서 생성'])
    expect(fetch).not.toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(showTemplates).not.toHaveBeenCalled()
  })

  it.each(['', '개인/일지', '할 일'])('템플릿 선택은 현재 폴더 %s를 전달하고 빈 메모는 만들지 않는다', async folder => {
    const state = useCreateMemo()
    state.creationItems(folder, showTemplates)[1]!.onSelect()
    await settle()
    expect(showTemplates).toHaveBeenCalledExactlyOnceWith(folder)
    expect(fetch).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('빈 메모 선택은 구조 변경을 먼저 반영하고 해당 폴더에 한 번 생성한 뒤 연다', async () => {
    const state = useCreateMemo()
    state.creationItems('개인/일지', showTemplates)[0]!.onSelect()
    expect(fetch).not.toHaveBeenCalled()
    await settle()
    expect(apply).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/memos', {
      method: 'POST', body: { folder: '개인/일지', title: '', content: '', date: null, dateEnd: null },
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/m/new-id')
    expect(showTemplates).not.toHaveBeenCalled()
    expect(state.creating.value).toBe(false)
  })

  it('대기 중 구조 변경을 저장하지 못하면 생성하지 않는다', async () => {
    apply.mockResolvedValueOnce(false)
    const state = useCreateMemo()
    state.creationItems('개인/일지', showTemplates)[0]!.onSelect()
    await settle()
    expect(fetch).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
