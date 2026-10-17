import { describe, expect, it } from 'vitest'
import { parseCreateInput, parseDoneInput, parseOrderInput, parseTodoOrderInput, parseUpdateInput } from './input'

const base = { title: '제목', content: '본문', date: null, dateEnd: null }

describe('요청 본문 검사', () => {
  it('하루짜리는 끝 날짜를 두지 않는다', () => {
    expect(parseCreateInput({ ...base, date: '2026-10-10', dateEnd: '2026-10-10' })).toMatchObject({ dateEnd: null })
  })

  it('잘못된 날짜·순서를 거부한다', () => {
    expect(() => parseCreateInput({ ...base, date: '2026-02-30' })).toThrow()
    expect(() => parseCreateInput({ ...base, date: '2026-10-10', dateEnd: '2026-10-09' })).toThrow()
    expect(() => parseCreateInput({ ...base, dateEnd: '2026-10-09' })).toThrow()
  })

  it('형식이 다른 값을 거부한다', () => {
    expect(() => parseCreateInput(null)).toThrow()
    expect(() => parseCreateInput([])).toThrow()
    expect(() => parseCreateInput({ ...base, title: 1 })).toThrow()
    expect(() => parseCreateInput({ ...base, folder: 1 })).toThrow()
    expect(() => parseUpdateInput(base)).toThrow()
  })

  it('folder 가 없으면 최상위다', () => {
    expect(parseCreateInput(base).folder).toBe('')
  })

  it('할 일: 새로 만들 때 done 은 불리언만, 없으면 메모. 수정 저장은 done 을 받지 않는다', () => {
    expect(parseCreateInput({ ...base, done: false }).done).toBe(false)
    expect(parseCreateInput(base).done).toBeUndefined()
    expect(() => parseCreateInput({ ...base, done: 'yes' })).toThrow()
    expect(parseUpdateInput({ ...base, baseVersion: 'v', done: true })).not.toHaveProperty('done')
  })

  it('할 일 체크 본문: true/false/null 만', () => {
    expect(parseDoneInput({ done: true })).toBe(true)
    expect(parseDoneInput({ done: false })).toBe(false)
    expect(parseDoneInput({ done: null })).toBeNull()
    expect(() => parseDoneInput({})).toThrow()
    expect(() => parseDoneInput({ done: 'true' })).toThrow()
    expect(() => parseDoneInput(null)).toThrow()
  })
})

describe('순서 요청', () => {
  it('넘긴 목록만 담고 중복은 뺀다', () => {
    expect(parseOrderInput({ folder: '업무', memos: ['a', 'b', 'a'] })).toEqual({ folder: '업무', patch: { memos: ['a', 'b'] } })
    expect(parseOrderInput({ folder: '', folders: ['가'] })).toEqual({ folder: '', patch: { folders: ['가'] } })
    expect(parseTodoOrderInput({ ids: ['x', 'y'] })).toEqual(['x', 'y'])
  })

  it('목록이 없거나 모양이 틀리면 거절한다', () => {
    expect(() => parseOrderInput({ folder: '업무' })).toThrow()
    expect(() => parseOrderInput({ folder: '업무', memos: [1] })).toThrow()
    expect(() => parseOrderInput({ folder: '업무', memos: [''] })).toThrow()
    expect(() => parseOrderInput({ memos: ['a'] })).toThrow()
    expect(() => parseTodoOrderInput({ ids: 'x' })).toThrow()
    expect(() => parseTodoOrderInput({ ids: Array.from({ length: 5001 }, (_, i) => `id${i}`) })).toThrow()
  })
})
