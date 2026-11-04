import type { PublicTreeResponse } from '#shared/types/memo'
import { memoLinkId } from '#shared/utils/memo-links'
import { isUlid } from '#shared/utils/ulid'

/** 공개 탐색 응답에 실제로 있는 영구 ID만 연결한다. 비공개 메타를 별도로 조회하지 않는다. */
export function publicMemoHref(tree: PublicTreeResponse | null | undefined, id: string): string | null {
  if (!tree || !isUlid(id)) return null
  if (tree.memos.some(memo => memo.id === id)) return `/ext/${encodeURIComponent(id)}`
  const folders = [...tree.folders]
  for (const folder of folders) {
    if (folder.memos.some(memo => memo.id === id)) return `/ext/${encodeURIComponent(id)}`
    folders.push(...folder.children)
  }
  return null
}

type ResolveHref = (id: string) => string | null
const sourceAttribute = 'data-public-memo-id'
const selector = `a[href], a[${sourceAttribute}]`

function setAttribute(anchor: Element, key: string, value: string | null) {
  if (anchor.getAttribute(key) === value) return
  if (value === null) anchor.removeAttribute(key)
  else anchor.setAttribute(key, value)
}

/** 원문에 있던 ID만 보존하며, 같은 요소가 다른 일반 URL로 갱신되면 건드리지 않는다. */
function sourceId(anchor: Element) {
  const href = anchor.getAttribute('href')
  const id = memoLinkId(href)
  if (id) return id
  const retained = anchor.getAttribute(sourceAttribute)
  if (!retained || !isUlid(retained)) return null
  return href === null || href === `/ext/${encodeURIComponent(retained)}` ? retained : null
}

function updateLink(anchor: Element, id: string, resolveHref: ResolveHref) {
  setAttribute(anchor, sourceAttribute, id)
  // resolver도 같은 ID의 정확한 공개 경로만 허용한다. /m·외부 URL로 우회하지 않는다.
  const expected = `/ext/${encodeURIComponent(id)}`
  if (resolveHref(id) === expected) {
    setAttribute(anchor, 'href', expected)
    setAttribute(anchor, 'aria-disabled', null)
    return true
  }
  setAttribute(anchor, 'href', null)
  setAttribute(anchor, 'target', null)
  setAttribute(anchor, 'tabindex', null)
  setAttribute(anchor, 'aria-disabled', 'true')
  return false
}

/** 참조형 Markdown의 일반 link mark도 공개 허용목록 안에서만 탐색한다. */
export function disablePublicMemoLinks(root: ParentNode, resolveHref: ResolveHref = () => null) {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>(selector)) {
    const id = sourceId(anchor)
    if (id) updateLink(anchor, id, resolveHref)
  }
}

/** DOM 갱신 직후 observer보다 먼저 들어온 클릭/키 입력에도 같은 경계를 적용한다. */
export function preventPublicMemoLink(event: MouseEvent | KeyboardEvent, resolveHref: ResolveHref = () => null) {
  if ('key' in event && event.key !== 'Enter') return
  const anchor = event.target instanceof Element ? event.target.closest(selector) : null
  const id = anchor ? sourceId(anchor) : null
  if (anchor && id && !updateLink(anchor, id, resolveHref)) {
    event.preventDefault()
    event.stopPropagation()
  }
}
