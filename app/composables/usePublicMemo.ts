import type { MemoMeta } from '#shared/types/memo'

/**
 * 외부 공개 (설계문서 §11.2) — 켜면 `/ext/{id}` 를 누구나 로그인 없이 읽기 전용으로 연다. 메모 메뉴·사이드바가 같이 쓴다.
 * 상태의 원본은 사이드바 트리(useMemoTree) — useTodo 처럼 서버 응답으로 트리의 그 메모를 바꾼다.
 * 열린 편집기와 맞출 것은 없다 — 서버가 버전을 public 줄을 빼고 잰다.
 */
export function usePublicMemo() {
  const toast = useToast()
  const { tree } = useMemoTree()
  const pending = useState<string[]>('public-pending', () => [])

  function isPublic(id: string) {
    return tree.value?.memos.find((m) => m.id === id)?.public ?? false
  }

  function isInherited(id: string) {
    return tree.value?.memos.find((m) => m.id === id)?.publicInherited ?? false
  }

  function publicUrl(id: string) {
    const publicId = tree.value?.memos.find((m) => m.id === id)?.publicId ?? id
    return `${window.location.origin}/ext/${encodeURIComponent(publicId)}`
  }

  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(publicUrl(id))
      toast.add({ title: '공개 링크를 복사했습니다' })
    } catch {
      toast.add({ color: 'error', title: '복사하지 못했습니다', description: publicUrl(id) })
    }
  }

  async function setPublic(id: string, value: boolean) {
    if (pending.value.includes(id)) return
    if (!value && isInherited(id)) {
      toast.add({ title: '폴더에서 공개 중입니다', description: '상위 폴더의 공개 설정에서 해제하세요.' })
      return
    }
    pending.value = [...pending.value, id]
    try {
      const meta = await $fetch<MemoMeta>(`/api/memos/${encodeURIComponent(id)}/public`, { method: 'PATCH', body: { public: value } })
      const memos = tree.value?.memos
      const index = memos?.findIndex((m) => m.id === id) ?? -1
      if (memos && index !== -1) memos[index] = { ...memos[index]!, public: meta.public, publicInherited: meta.publicInherited, publicDirect: meta.publicDirect, publicId: meta.publicId }
      // 클립보드는 누른 그 순간에만 쓸 수 있다(서버 응답 뒤엔 사파리가 막는다) — 알림의 버튼으로 복사한다
      if (meta.public) {
        toast.add({
          title: '외부 공개했습니다',
          description: '링크를 아는 사람은 로그인 없이 읽을 수 있습니다.',
          actions: [{ label: '링크 복사', color: 'neutral', variant: 'outline', onClick: () => void copyLink(id) }],
        })
      } else {
        toast.add({ title: '외부 공개를 껐습니다', description: '공개 링크는 더 이상 열리지 않습니다.' })
      }
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '외부 공개를 바꾸지 못했습니다') })
    } finally {
      pending.value = pending.value.filter((p) => p !== id)
    }
  }

  return { pending, isPublic, isInherited, publicUrl, copyLink, setPublic }
}
