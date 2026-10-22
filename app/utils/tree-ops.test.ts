import { describe, expect, it } from 'vitest'
import type { MemoMeta, TreeResponse } from '../../shared/types/memo'
import { applyStructureOps } from './tree-ops'

function memo(id: string, path: string): MemoMeta {
  const i = path.lastIndexOf('/')
  return { id, path, folder: i === -1 ? '' : path.slice(0, i), title: id, created: null, updated: null, date: null, dateEnd: null, tags: [], done: null, priority: 'medium', public: false, unreadable: false }
}

const base: TreeResponse = {
  folders: [
    { path: '가', name: '가', children: [{ path: '가/하위', name: '하위', children: [] }] },
    { path: '나', name: '나', children: [] },
  ],
  memos: [memo('a', '가/a.md'), memo('b', '가/하위/b.md'), memo('c', 'c.md')],
  orders: { '': { folders: ['나', '가'], memos: [] }, '가/하위': { folders: [], memos: ['b'] } },
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

  it('「할 일」 폴더로 옮기면 할 일, 밖으로 옮기면 일반 메모가 된다 (중요도도 지운다)', () => {
    const into = applyStructureOps(base, [{ kind: 'moveMemo', id: 'c', title: 'c', folder: '할 일' }])!
    expect(into.memos.find((m) => m.id === 'c')).toMatchObject({ folder: '할 일', done: false })
    const todo: TreeResponse = { ...base, memos: [{ ...memo('t', '할 일/t.md'), done: true, priority: 'high' }] }
    const out = applyStructureOps(todo, [{ kind: 'moveMemo', id: 't', title: 't', folder: '' }])!
    expect(out.memos[0]).toMatchObject({ folder: '', path: 't.md', done: null, priority: 'medium' })
    // 할 일 폴더 안의 끝낸 할 일은 다른 폴더를 거쳐 돌아오면 안 끝난 할 일 — 서버와 같다
    const back = applyStructureOps(todo, [{ kind: 'moveMemo', id: 't', title: 't', folder: '나' }, { kind: 'moveMemo', id: 't', title: 't', folder: '할 일' }])!
    expect(back.memos[0]).toMatchObject({ folder: '할 일', done: false })
  })

  it('없는 경로를 가리키는 변경은 건너뛴다', () => {
    const next = applyStructureOps(base, [{ kind: 'moveFolder', path: '없음', parent: '나' }])!
    expect(next.folders.map((f) => f.path)).toEqual(['가', '나'])
  })
})

describe('대기 중인 변경과 순서', () => {
  it('이름을 바꾸면 위 폴더 순서에서 자리를 지키고, 하위 순서도 따라간다', () => {
    const next = applyStructureOps(base, [{ kind: 'renameFolder', path: '가', name: '다' }])!
    expect(next.orders['']?.folders).toEqual(['나', '다'])
    expect(next.orders['다/하위']).toEqual({ folders: [], memos: ['b'] })
    expect(next.orders['가/하위']).toBeUndefined()
    // 원본은 그대로
    expect(base.orders['']?.folders).toEqual(['나', '가'])
  })

  it('다른 폴더로 옮기면 새 자리 순서에는 없다 (맨 위) — 서버와 같다', () => {
    const next = applyStructureOps(base, [{ kind: 'moveFolder', path: '가', parent: '나' }])!
    expect(next.orders['']?.folders).toEqual(['나', '가'])
    expect(next.orders['나/가/하위']).toEqual({ folders: [], memos: ['b'] })
  })
})
