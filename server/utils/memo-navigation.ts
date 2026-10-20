import { MemoNavigationStore } from '../memo/navigation'

let navigation: MemoNavigationStore | null = null

export async function useMemoNavigationStore() {
  const store = await useMemoStore()
  navigation ??= new MemoNavigationStore(store.root, async () => (await store.tree()).memos)
  return navigation
}
