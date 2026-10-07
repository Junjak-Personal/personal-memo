/**
 * 폴더 만들기·이름 바꾸기·옮기기·지우기 (설계문서 §3.4). 사이드바가 쓴다.
 *
 * 이름 바꾸기(5초)·옮기기(3초)는 대기열에 넣는다 — 트리에는 바로 보이고 파일은 나중에 바뀐다 (useStructureQueue).
 * 만들기·지우기는 바로 한다. 지우기는 서버가 「비었는가」를 판단해야 해서 미리 보여 줄 수 없다.
 * 둘 다 대기 중인 변경을 먼저 반영한다 — 화면에만 있는 경로에 폴더를 만들거나 지우면 서버와 어긋난다.
 */
type DialogState =
  | { mode: 'closed' }
  | { mode: 'create'; parent: string }
  | { mode: 'rename'; path: string; name: string }

interface Options {
  /** 폴더 경로가 바뀌었을 때 — 사이드바가 펼침 상태를 새 경로로 옮긴다 */
  onRelocated: (from: string, to: string) => void
}

export function useFolderActions(options: Options) {
  const toast = useToast()
  const { refresh } = useMemoTree()
  const queue = useStructureQueue()

  const dialog = ref<DialogState>({ mode: 'closed' })
  /** 폰에서 끌어 놓기 대신 쓰는 「다른 폴더로 옮기기」 대상 */
  const moving = ref<string | null>(null)
  const busy = ref(false)

  const dialogOpen = computed({
    get: () => dialog.value.mode !== 'closed',
    set: (value: boolean) => {
      if (!value) dialog.value = { mode: 'closed' }
    },
  })

  const moveOpen = computed({
    get: () => moving.value !== null,
    set: (value: boolean) => {
      if (!value) moving.value = null
    },
  })

  function startCreate(parent = '') {
    dialog.value = { mode: 'create', parent }
  }

  function startRename(path: string) {
    dialog.value = { mode: 'rename', path, name: path.slice(path.lastIndexOf('/') + 1) }
  }

  function startMove(path: string) {
    moving.value = path
  }

  async function submit(name: string) {
    const state = dialog.value
    if (state.mode === 'closed' || busy.value) return
    if (state.mode === 'rename') {
      if (name !== state.path.slice(state.path.lastIndexOf('/') + 1)) {
        const to = parentOf(state.path) ? `${parentOf(state.path)}/${name}` : name
        queue.push({ kind: 'renameFolder', path: state.path, name })
        options.onRelocated(state.path, to)
      }
      dialog.value = { mode: 'closed' }
      return
    }
    busy.value = true
    try {
      if (!(await queue.apply())) return
      await $fetch('/api/folders', { method: 'POST', body: { parent: state.parent, name } })
      await refresh()
      dialog.value = { mode: 'closed' }
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '폴더를 만들지 못했습니다') })
    } finally {
      busy.value = false
    }
  }

  function move(parent: string) {
    const path = moving.value
    if (path === null) return
    const name = path.slice(path.lastIndexOf('/') + 1)
    queue.push({ kind: 'moveFolder', path, parent })
    options.onRelocated(path, parent ? `${parent}/${name}` : name)
    moving.value = null
  }

  async function remove(path: string) {
    try {
      if (!(await queue.apply())) return
      await $fetch('/api/folders', { method: 'DELETE', query: { path } })
      await refresh()
      toast.add({ title: `「${path}」 폴더를 지웠습니다` })
    } catch (e) {
      toast.add({ color: 'error', title: apiMessage(e, '폴더를 지우지 못했습니다') })
    }
  }

  return { dialog, dialogOpen, moving, moveOpen, busy, startCreate, startRename, startMove, submit, move, remove }
}
