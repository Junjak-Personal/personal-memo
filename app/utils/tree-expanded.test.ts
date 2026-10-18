import { describe, expect, it } from 'vitest'
import { readExpanded, writeExpanded } from './tree-expanded'

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

describe('tree-expanded', () => {
  it('쓰고 읽는다', () => {
    const store = new MemoryStorage()
    writeExpanded(['folder:개발', 'folder:개발/Nivoca'], store)
    expect(readExpanded(store)).toEqual(['folder:개발', 'folder:개발/Nivoca'])
  })

  it('전부 접은 것(빈 목록)도 기억한다 — 기억 없음(null)과 다르다', () => {
    const store = new MemoryStorage()
    expect(readExpanded(store)).toBeNull()
    writeExpanded([], store)
    expect(readExpanded(store)).toEqual([])
  })

  it('깨진 값은 null', () => {
    const store = new MemoryStorage()
    store.setItem('memo-tree-expanded', '{')
    expect(readExpanded(store)).toBeNull()
    store.setItem('memo-tree-expanded', '[1,2]')
    expect(readExpanded(store)).toBeNull()
  })

  it('저장소가 막혀 있어도 던지지 않는다', () => {
    const blocked = new MemoryStorage()
    blocked.getItem = () => {
      throw new Error('blocked')
    }
    blocked.setItem = () => {
      throw new Error('blocked')
    }
    expect(readExpanded(blocked)).toBeNull()
    expect(() => writeExpanded(['folder:a'], blocked)).not.toThrow()
    expect(readExpanded(null)).toBeNull()
  })
})
