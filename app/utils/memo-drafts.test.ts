import { describe, expect, it } from 'vitest'
import { listDrafts, type MemoDraft, readDraft, removeDraft, writeDraft } from './memo-drafts'

/** localStorage 흉내 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, value)
  }
}

function draft(id: string): MemoDraft {
  return {
    id,
    baseVersion: 'v1',
    input: { title: '제목', content: '본문', date: null, dateEnd: null, tags: ['업무'] },
    savedAt: '2026-10-07T02:00:00.000Z',
  }
}

describe('memo-drafts', () => {
  it('쓰고 읽고 지운다', () => {
    const store = new MemoryStorage()
    expect(writeDraft(draft('A'), store)).toBe(true)
    expect(readDraft('A', store)).toEqual(draft('A'))
    removeDraft('A', store)
    expect(readDraft('A', store)).toBeNull()
  })

  it('목록은 보관함 키만, 모양이 틀린 것은 뺀다', () => {
    const store = new MemoryStorage()
    writeDraft(draft('A'), store)
    writeDraft(draft('p:업무/회의.md'), store)
    store.setItem('memo-draft:broken', '{"id":"broken"}')
    store.setItem('memo-draft:notjson', '{')
    store.setItem('other', 'x')
    expect(listDrafts(store).map((d) => d.id).sort()).toEqual(['A', 'p:업무/회의.md'])
  })

  it('저장소를 못 쓰면 조용히 false', () => {
    const broken = new MemoryStorage()
    broken.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(writeDraft(draft('A'), broken)).toBe(false)
    expect(writeDraft(draft('A'), null)).toBe(false)
    expect(listDrafts(null)).toEqual([])
  })
})
