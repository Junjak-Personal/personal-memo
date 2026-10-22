import { describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '#shared/types/memo'
import { currentSearchResults, searchResultMenu } from './search-result-menu'

const hit = (id: string): SearchHit => ({ id, title: id, path: `${id}.md`, folder: '', created: null, updated: null, date: null, dateEnd: null, tags: [], done: null, public: false, unreadable: false, snippet: '검색에서 일치한 본문' })
const state = { favorite: false, favoritePending: false, todoPending: false, removing: false, desktop: true }
function setup(memo = hit('one'), patch: Partial<typeof state> = {}) {
  const actions = { favorite: vi.fn(), copy: vi.fn(), todo: vi.fn(), move: vi.fn(), trash: vi.fn() }
  const menu = searchResultMenu(memo, { ...state, ...patch }, actions).flat()
  const item = (name: string) => menu.find(item => item.testId === `sidebar-search-${name}`)!
  return { menu, item, actions }
}

describe('검색 결과의 현재 메모 정보와 작업 메뉴', () => {
  it('검색 순위와 발췌를 보존하면서 이동·이름·태그·할 일의 최신 상태를 반영한다', () => {
    const first = hit('one'), second = hit('two')
    const updated = { ...first, title: '새 이름', folder: '옮긴 폴더', done: true, tags: ['새 태그'] }
    const rows = currentSearchResults([second, first], [updated, second])
    expect(rows.map(row => row.id)).toEqual(['two', 'one'])
    expect(rows[1]).toMatchObject({ title: '새 이름', folder: '옮긴 폴더', done: true, tags: ['새 태그'], snippet: first.snippet })
    expect(first.title).toBe('one')
  })
  it('목록을 아직 받지 않았거나 외부 메모가 검색에 먼저 나타나도 검색 결과를 버리지 않는다', () => {
    const hits = [hit('external')]
    expect(currentSearchResults(hits, null)).toEqual(hits)
    expect(currentSearchResults(hits, [])).toEqual(hits)
  })
  it('경로 ID의 슬래시를 인코딩하고 새 탭은 데스크톱에서 안전한 링크로 제공한다', () => {
    const { item } = setup(hit('p:업무/회의.md'))
    expect(item('open').to).toBe('/m/p%3A%EC%97%85%EB%AC%B4%2F%ED%9A%8C%EC%9D%98.md')
    expect(item('open-tab')).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' })
    expect(setup(hit('one'), { desktop: false }).menu.some(item => item.testId === 'sidebar-search-open-tab')).toBe(false)
  })
  it.each([null, false, true])('현재 할 일 상태 %s에 맞는 값만 전달한다', done => {
    const { item, actions } = setup({ ...hit('one'), done })
    item('todo').onSelect?.(new Event('select'))
    expect(actions.todo).toHaveBeenLastCalledWith(done === null ? false : null)
    if (done !== null) {
      item('complete').onSelect?.(new Event('select'))
      expect(actions.todo).toHaveBeenLastCalledWith(!done)
    } else expect(item('complete')).toBeUndefined()
  })
  it('읽기 불가 메모는 메타를 변경하지 않지만 읽기·주소 복사·안전한 휴지통 이동은 가능하다', () => {
    const { item } = setup({ ...hit('one'), unreadable: true })
    expect(item('todo').disabled).toBe(true)
    expect(item('favorite').disabled).toBe(true)
    expect(item('open').disabled).toBeUndefined()
    expect(item('copy').disabled).toBeUndefined()
    expect(item('trash').disabled).toBe(false)
  })
  it.each([{ todoPending: true }, { removing: true }])('진행 중 작업 %j와 삭제/이동/할 일 변경이 겹치지 않는다', pending => {
    const { item } = setup(hit('one'), pending)
    for (const name of ['todo', 'favorite', 'move', 'trash']) expect(item(name).disabled).toBe(true)
  })
  it('별표 저장 중에는 중복 클릭을 막고 삭제는 기존 휴지통 핸들러로만 보낸다', () => {
    const { item, actions } = setup(hit('one'), { favorite: true, favoritePending: true })
    expect(item('favorite').disabled).toBe(true)
    item('trash').onSelect?.(new Event('select'))
    expect(actions.trash).toHaveBeenCalledOnce()
    expect(actions.todo).not.toHaveBeenCalled()
    expect(actions.move).not.toHaveBeenCalled()
  })
})
