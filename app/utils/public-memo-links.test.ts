import { afterEach, describe, expect, it, vi } from 'vitest'
import { disablePublicMemoLinks, preventPublicMemoLink } from './public-memo-links'

class Anchor {
  attributes: Map<string, string>
  constructor(href: string) { this.attributes = new Map([['href', href], ['target', '_blank'], ['tabindex', '0']]) }
  getAttribute(key: string) { return this.attributes.get(key) ?? null }
  removeAttribute(key: string) { this.attributes.delete(key) }
  setAttribute(key: string, value: string) { this.attributes.set(key, value) }
  closest() { return this }
}
const internal = '/m/01M5D265Y7R61BQEFWDT6RA27E'
describe('공개 문서의 내부 링크 DOM 경계', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('일반 link mark로 렌더된 내부 주소와 포커스만 제거하고 외부 링크는 유지한다', () => {
    const privateAnchor = new Anchor(internal)
    const publicAnchor = new Anchor('https://example.com/m/01M5A123456789ABCDEFGHJKMNPQ')
    const root = { querySelectorAll: () => [privateAnchor, publicAnchor] } as unknown as ParentNode
    disablePublicMemoLinks(root)
    expect(privateAnchor.getAttribute('href')).toBeNull()
    expect(privateAnchor.getAttribute('tabindex')).toBeNull()
    expect(privateAnchor.getAttribute('aria-disabled')).toBe('true')
    expect(publicAnchor.getAttribute('href')).toMatch(/^https:/)
    expect(publicAnchor.getAttribute('target')).toBe('_blank')
    // 두 번 실행해도 추가적인 변경이나 주소 재생성이 없다.
    disablePublicMemoLinks(root)
    expect(privateAnchor.getAttribute('href')).toBeNull()
  })
  it('observer 전 내부 클릭/Enter를 막고 외부 클릭/일반 키는 유지한다', () => {
    vi.stubGlobal('Element', Anchor)
    const run = (href: string, key?: string) => {
      const event = { target: new Anchor(href), ...(key ? { key } : {}), preventDefault: vi.fn(), stopPropagation: vi.fn() }
      preventPublicMemoLink(event as unknown as MouseEvent)
      return event.preventDefault.mock.calls.length
    }
    expect(run(internal)).toBe(1)
    expect(run(internal, 'Enter')).toBe(1)
    expect(run(internal, 'ArrowRight')).toBe(0)
    expect(run('https://example.com')).toBe(0)
  })
})
