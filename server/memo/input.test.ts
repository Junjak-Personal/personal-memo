import { describe, expect, it } from 'vitest'
import { parseCreateInput, parseUpdateInput } from './input'

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
})
