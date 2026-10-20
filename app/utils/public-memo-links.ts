import { memoLinkId } from '#shared/utils/memo-links'

/** 참조형 Markdown 등 일반 link mark로 읽힌 내부 링크도 공개 DOM에서는 주소를 내리지 않는다. */
export function disablePublicMemoLinks(root: ParentNode) {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!memoLinkId(anchor.getAttribute('href'))) continue
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.removeAttribute('tabindex')
    anchor.setAttribute('aria-disabled', 'true')
  }
}

/** DOM 갱신 직후 observer보다 먼저 들어온 클릭/키 입력도 탐색으로 이어지지 않는다. */
export function preventPublicMemoLink(event: MouseEvent | KeyboardEvent) {
  if ('key' in event && event.key !== 'Enter') return
  const element = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (element && memoLinkId(element.getAttribute('href'))) {
    event.preventDefault()
    event.stopPropagation()
  }
}
