/**
 * 폴더 구조 변경(옮기기·이름 바꾸기)을 트리에 «미리» 반영한다.
 *
 * 실제 파일 이동은 마지막 변경 뒤 몇 초 기다렸다가 한꺼번에 한다(useStructureQueue). 그동안 사이드바는 옮긴 자리를
 * 바로 보여줘야 하므로, 서버가 준 트리에 대기 중인 변경을 차례로 얹은 사본을 그린다.
 * 각 변경의 경로는 «그 변경을 만든 순간의 화면» 기준이다 — 앞 변경을 얹은 뒤에 맞는 경로다. 서버도 같은 순서로 실행한다.
 */
import type { FolderNode, MemoMeta, TreeResponse } from '#shared/types/memo'

export type StructureOp =
  | { kind: 'moveMemo'; id: string; title: string; folder: string }
  | { kind: 'moveFolder'; path: string; parent: string }
  | { kind: 'renameFolder'; path: string; name: string }

export function parentOf(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function nameOf(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function join(folder: string, name: string) {
  return folder ? `${folder}/${name}` : name
}

/** `가/나` 를 `다/나` 로 옮기면 `가/나/라` 는 `다/나/라` */
function rebase(path: string, from: string, to: string) {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

function cloneFolders(folders: FolderNode[]): FolderNode[] {
  return folders.map((f) => ({ ...f, children: cloneFolders(f.children) }))
}

function rebaseNode(node: FolderNode, from: string, to: string): FolderNode {
  return { ...node, path: rebase(node.path, from, to), children: node.children.map((c) => rebaseNode(c, from, to)) }
}

function sortFolders(folders: FolderNode[]) {
  return folders.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

/** 경로의 폴더를 떼어낸다. 떼어낸 노드를 돌려준다 */
function detach(folders: FolderNode[], path: string): FolderNode | null {
  const i = folders.findIndex((f) => f.path === path)
  if (i !== -1) return folders.splice(i, 1)[0] ?? null
  for (const f of folders) {
    const found = detach(f.children, path)
    if (found) return found
  }
  return null
}

/** 경로의 폴더 자식 목록 (최상위는 ''). 없으면 null */
function childrenOf(folders: FolderNode[], path: string): FolderNode[] | null {
  if (path === '') return folders
  for (const f of folders) {
    if (f.path === path) return f.children
    const found = childrenOf(f.children, path)
    if (found) return found
  }
  return null
}

function relocateFolder(tree: TreeResponse, from: string, to: string, name: string) {
  const node = detach(tree.folders, from)
  const target = childrenOf(tree.folders, parentOf(to))
  if (!node || !target) return
  target.push({ ...rebaseNode(node, from, to), name })
  sortFolders(target)
  tree.memos = tree.memos.map((m) => {
    const folder = rebase(m.folder, from, to)
    return folder === m.folder ? m : { ...m, folder, path: join(folder, nameOf(m.path)) }
  })
}

export function applyStructureOps(tree: TreeResponse | null, ops: readonly StructureOp[]): TreeResponse | null {
  if (!tree || !ops.length) return tree
  const next: TreeResponse = { folders: cloneFolders(tree.folders), memos: tree.memos.map((m): MemoMeta => ({ ...m })) }
  for (const op of ops) {
    if (op.kind === 'moveMemo') {
      next.memos = next.memos.map((m) => (m.id === op.id ? { ...m, folder: op.folder, path: join(op.folder, nameOf(m.path)) } : m))
    } else if (op.kind === 'moveFolder') {
      relocateFolder(next, op.path, join(op.parent, nameOf(op.path)), nameOf(op.path))
    } else {
      relocateFolder(next, op.path, join(parentOf(op.path), op.name), op.name)
    }
  }
  return next
}
