import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicTreeResponse } from '#shared/types/memo'
import { disablePublicMemoLinks, preventPublicMemoLink, publicMemoHref } from './public-memo-links'

class Anchor {
  attributes: Map<string, string>
  mutations = 0
  constructor(href: string) { this.attributes = new Map([['href', href], ['target', '_blank'], ['tabindex', '0']]) }
  getAttribute(key: string) { return this.attributes.get(key) ?? null }
  removeAttribute(key: string) { this.mutations++; this.attributes.delete(key) }
  setAttribute(key: string, value: string) { this.mutations++; this.attributes.set(key, value) }
  closest(selector: string) {
    return selector.includes('a[href]') && this.attributes.has('href')
      || selector.includes('a[data-public-memo-id]') && this.attributes.has('data-public-memo-id') ? this : null
  }
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


const publicId = '01M5D265Y7R61BQEFWDT6RA27E'
const nestedId = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const missingId = '01M5A123456789ABCDEFGHJKMNPQ'
const tree: PublicTreeResponse = {
  memos: [{ id: publicId, title: '공개 메모' }],
  folders: [{ id: 'folder', name: '공개 폴더', memos: [], children: [
    { id: 'nested', name: '중첩', children: [], memos: [{ id: nestedId, title: '중첩 공개 메모' }] },
  ] }],
}
const rootOf = (...anchors: Anchor[]) => ({ querySelectorAll: (selector: string) => anchors.filter(anchor => anchor.closest(selector)) }) as unknown as ParentNode

describe('공개 트리로 허용한 메모 링크', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('루트·중첩 공개 메모 ID만 허용하고 비공개·없는 ID·준비 전은 차단한다', () => {
    expect(publicMemoHref(tree, publicId)).toBe(`/ext/${publicId}`)
    expect(publicMemoHref(tree, nestedId)).toBe(`/ext/${nestedId}`)
    expect(publicMemoHref(tree, missingId)).toBeNull()
    expect(publicMemoHref(tree, 'folder')).toBeNull()
    expect(publicMemoHref(tree, 'p:private/path.md')).toBeNull()
    expect(publicMemoHref(tree, '../private')).toBeNull()
    expect(publicMemoHref(undefined, publicId)).toBeNull()
    expect(publicMemoHref(null, publicId)).toBeNull()
  })
  it('트리 허용목록 판정은 비공개 API나 원문·제목 조회를 만들지 않는다', () => {
    const fetch = vi.fn()
    vi.stubGlobal('$fetch', fetch)
    vi.stubGlobal('fetch', fetch)
    publicMemoHref(tree, publicId)
    publicMemoHref(tree, missingId)
    publicMemoHref(undefined, missingId)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('트리 준비 전에 비활성화한 링크를 공개 트리 완료 후 복원한다', () => {
    const anchor = new Anchor(internal)
    const root = rootOf(anchor)
    disablePublicMemoLinks(root)
    expect(anchor.getAttribute('href')).toBeNull()
    expect(anchor.getAttribute('data-public-memo-id')).toBe(publicId)
    disablePublicMemoLinks(root, id => publicMemoHref(tree, id))
    expect(anchor.getAttribute('href')).toBe(`/ext/${publicId}`)
    expect(anchor.getAttribute('aria-disabled')).toBeNull()
  })
  it('허용된 링크도 공개 해제되면 즉시 비활성화하고 /m으로 복귀시키지 않는다', () => {
    const anchor = new Anchor(internal)
    const root = rootOf(anchor)
    disablePublicMemoLinks(root, id => publicMemoHref(tree, id))
    disablePublicMemoLinks(root, () => null)
    expect(anchor.getAttribute('href')).toBeNull()
    expect(anchor.getAttribute('aria-disabled')).toBe('true')
    disablePublicMemoLinks(root, () => internal)
    expect(anchor.getAttribute('href')).toBeNull()
  })
  it('허용·비허용 상태의 반복 observer pass는 속성을 다시 변경하지 않는다', () => {
    const anchor = new Anchor(internal)
    const root = rootOf(anchor)
    const resolve = (id: string) => publicMemoHref(tree, id)
    disablePublicMemoLinks(root, resolve)
    const allowedMutations = anchor.mutations
    disablePublicMemoLinks(root, resolve)
    expect(anchor.mutations).toBe(allowedMutations)
    disablePublicMemoLinks(root)
    const disabledMutations = anchor.mutations
    disablePublicMemoLinks(root)
    expect(anchor.mutations).toBe(disabledMutations)
  })
  it('이미 추적한 링크의 href가 일반 URL로 바뀌면 이전 ID로 덮어쓰지 않는다', () => {
    for (const href of ['https://example.com', 'mailto:hello@example.com', '/ext/other', '/about']) {
      const anchor = new Anchor(internal)
      const root = rootOf(anchor)
      disablePublicMemoLinks(root, id => publicMemoHref(tree, id))
      anchor.setAttribute('href', href)
      const mutations = anchor.mutations
      disablePublicMemoLinks(root, id => publicMemoHref(tree, id))
      expect(anchor.getAttribute('href')).toBe(href)
      expect(anchor.mutations).toBe(mutations)
    }
  })
  it('observer 전 클릭에서 공개 대상은 /ext로 바꿔 허용하고 비공개 대상은 막는다', () => {
    vi.stubGlobal('Element', Anchor)
    const anchor = new Anchor(internal)
    const event = { target: anchor, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    preventPublicMemoLink(event as unknown as MouseEvent, id => publicMemoHref(tree, id))
    expect(anchor.getAttribute('href')).toBe(`/ext/${publicId}`)
    expect(event.preventDefault).not.toHaveBeenCalled()
    preventPublicMemoLink(event as unknown as MouseEvent)
    expect(anchor.getAttribute('href')).toBeNull()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
  })
  it('href가 제거된 링크의 Enter도 공개 허용목록으로 복원하며 외부 resolver 반환은 거부한다', () => {
    vi.stubGlobal('Element', Anchor)
    const anchor = new Anchor(internal)
    disablePublicMemoLinks(rootOf(anchor))
    const event = { target: anchor, key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    preventPublicMemoLink(event as unknown as KeyboardEvent, id => publicMemoHref(tree, id))
    expect(anchor.getAttribute('href')).toBe(`/ext/${publicId}`)
    expect(event.preventDefault).not.toHaveBeenCalled()
    preventPublicMemoLink(event as unknown as KeyboardEvent, () => 'https://example.com')
    expect(anchor.getAttribute('href')).toBeNull()
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})
