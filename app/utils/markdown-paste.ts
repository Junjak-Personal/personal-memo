/**
 * 마크다운 글 붙여넣기 (2026-10-15 사용자 요청) — 마크다운 원문을 붙여 넣으면 글자 그대로가 아니라 서식으로 넣는다.
 *
 * 붙여넣을 때마다 마크다운으로 읽으면 안 된다:
 * - 웹 페이지·문서 앱에서 복사한 것은 클립보드에 서식 있는 HTML 이 같이 온다 — 그 HTML 이 더 정확하다.
 *   VS Code 처럼 글자에 색만 입힌 HTML(div·span 뿐)은 서식이 아니다 — 그때는 마크다운 원문을 읽는다.
 * - 이 앱 안에서 복사한 것(ProseMirror 조각)은 편집기가 그대로 붙인다.
 * - 문법이 안 보이는 보통 글은 기본 붙여넣기에 맡긴다. 마크다운으로 읽으면 한 줄 바꿈이 한 문단으로 합쳐진다.
 */

/** 줄 맨 앞에서만 뜻을 갖는 문법 — 제목, 목록, 체크리스트, 인용, 코드 블록, 표 구분줄 */
const BLOCK = [
  /^#{1,6}[ \t]+\S/m,
  /^[ \t]*[-*+][ \t]+\S/m,
  /^[ \t]*\d{1,9}[.)][ \t]+\S/m,
  /^>[ \t]?\S/m,
  /^(```|~~~)/m,
  /^\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m,
]

/** 줄 안의 문법 — 굵게, 링크·이미지, 인라인 코드, 취소선. 홑 `*`·`_` 기울임은 곱셈·밑줄 이름과 헷갈려 보지 않는다 */
const INLINE = [/\*\*[^*\n]+\*\*/, /__[^_\n]+__/, /!?\[[^\]\n]+\]\([^)\s]+\)/, /`[^`\n]+`/, /~~[^~\n]+~~/]

export function looksLikeMarkdown(text: string) {
  return BLOCK.some((re) => re.test(text)) || INLINE.some((re) => re.test(text))
}

/** 서식을 뜻하는 HTML 요소 — 하나라도 있으면 이미 서식 있는 문서다 */
const RICH_TAG = /<(h[1-6]|ul|ol|li|strong|b|em|i|a|table|blockquote|pre|code|img|hr)[\s>]/i

export function isRichHtml(html: string) {
  return html.includes('data-pm-slice') || RICH_TAG.test(html)
}
