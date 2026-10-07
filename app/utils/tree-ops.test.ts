import { describe, expect, it } from 'vitest'
import type { MemoMeta, TreeResponse } from '../../shared/types/memo'
import { applyStructureOps } from './tree-ops'

function memo(id: string, path: string): MemoMeta {
  const i = path.lastIndexOf('/')
  return { id, path, folder: i === -1 ? '' : path.slice(0, i), title: id, created: null, updated: null, date: null, dateEnd: null, tags: [], done: null, unreadable: false }
}

const base: TreeResponse = {
  folders: [
    { path: '가', name: '가', children: [{ path: '가/하위', name: '하위', children: [] }] },
    { path: '나', name: '나', children: [] },
  ],
  memos: [memo('a', '가/a.md'), memo('b', '가/하위/b.md'), memo('c', 'c.md')],
}

describe('대기 중인 폴더 구조 변경을 트리에 미리 얹기', () => {
  it('메모를 다른 폴더로', () => {
    const next = applyStructureOps(base, [{ kind: 'moveMemo', id: 'c', title: 'c', folder: '나' }])!
    expect(next.memos.find((m) => m.id === 'c')).toMatchObject({ folder: '나', path: '나/c.md' })
    // 원본은 그대로
    expect(base.memos.find((m) => m.id === 'c')?.folder).toBe('')
  })

  it('폴더를 옮기면 하위 폴더·메모 경로가 함께 바뀐다', () => {
    const next = applyStructureOps(base, [{ kind: 'moveFolder', path: '가', parent: '나' }])!
    expect(next.folders.map((f) => f.path)).toEqual(['나'])
    expect(next.folders[0]!.children[0]).toMatchObject({ path: '나/가', children: [{ path: '나/가/하위' }] })
    expect(next.memos.find((m) => m.id === 'b')).toMatchObject({ folder: '나/가/하위', path: '나/가/하위/b.md' })
  })

  it('폴더 이름을 바꾸면 경로가 바뀌고 다시 정렬된다', () => {
    const next = applyStructureOps(base, [{ kind: 'renameFolder', path: '가', name: '다' }])!
    expect(next.folders.map((f) => f.path)).toEqual(['나', '다'])
    expect(next.memos.find((m) => m.id === 'a')?.path).toBe('다/a.md')
  })

  it('앞 변경이 만든 경로로 뒤 변경을 이어 얹는다', () => {
    const next = applyStructureOps(base, [
      { kind: 'moveFolder', path: '가', parent: '나' },
      { kind: 'moveFolder', path: '나/가/하위', parent: '' },
    ])!
    expect(next.folders.map((f) => f.path).sort()).toEqual(['나', '하위'])
    expect(next.memos.find((m) => m.id === 'b')?.path).toBe('하위/b.md')
  })

  it('없는 경로를 가리키는 변경은 건너뛴다', () => {
    const next = applyStructureOps(base, [{ kind: 'moveFolder', path: '없음', parent: '나' }])!
    expect(next.folders.map((f) => f.path)).toEqual(['가', '나'])
  })
})
