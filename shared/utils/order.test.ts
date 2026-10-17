import { describe, expect, it } from 'vitest'
import { applyOrder, byCreatedDesc, byName, moveKey, stepKey } from './order'

const memo = (id: string, created: string | null, title = id) => ({ id, created, title })
const ids = (list: { id: string }[]) => list.map((m) => m.id)

describe('applyOrder — 저장된 순서대로, 순서에 없는 것은 맨 위', () => {
  it('순서가 없으면 만든 시각 최근순 (만든 시각 없는 바깥 파일은 뒤)', () => {
    const list = [memo('a', '2026-10-01T09:00:00+09:00'), memo('b', null), memo('c', '2026-10-03T09:00:00+09:00')]
    expect(ids(applyOrder(list, [], (m) => m.id, byCreatedDesc))).toEqual(['c', 'a', 'b'])
  })

  it('저장된 순서를 따르고, 새로 생긴 것은 그 위에', () => {
    const list = [memo('a', '2026-10-01'), memo('b', '2026-10-02'), memo('c', '2026-10-03'), memo('new', '2026-10-09')]
    expect(ids(applyOrder(list, ['a', 'c', 'b'], (m) => m.id, byCreatedDesc))).toEqual(['new', 'a', 'c', 'b'])
  })

  it('순서에 남은 지워진 id 는 무시한다', () => {
    const list = [memo('a', '2026-10-01'), memo('b', '2026-10-02')]
    expect(ids(applyOrder(list, ['gone', 'b', 'a'], (m) => m.id, byCreatedDesc))).toEqual(['b', 'a'])
  })

  it('폴더는 이름순이 기본', () => {
    const folders = [{ name: '하' }, { name: '가' }, { name: '나' }]
    expect(applyOrder(folders, ['하'], (f) => f.name, byName).map((f) => f.name)).toEqual(['가', '나', '하'])
  })
})

describe('moveKey — 끌어 놓은 자리로', () => {
  it('앞·뒤로 옮긴다', () => {
    expect(moveKey(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveKey(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
    expect(moveKey(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a'])
  })

  it('자기 자신이나 없는 것은 그대로', () => {
    expect(moveKey(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b'])
    expect(moveKey(['a', 'b'], 'x', 'a', 'before')).toEqual(['a', 'b'])
  })
})

describe('stepKey — 폰 메뉴의 위로·아래로', () => {
  it('한 칸씩, 끝에서는 그대로', () => {
    expect(stepKey(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(stepKey(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(stepKey(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(stepKey(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c'])
  })
})
