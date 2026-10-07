/**
 * 태그 (설계문서 §3.1) — frontmatter `tags: [업무, 회의]`. 서버의 파일 읽기·입력 검사와 화면이 같은 규칙을 쓴다.
 */
export const MAX_TAGS = 30
export const MAX_TAG_LENGTH = 50
/** 태그 입력칸에서 태그를 끊는 글자 — 공백·쉼표. 그래서 앱에서 만든 태그에는 공백이 없다 (`#태그` 검색과 맞물린다) */
export const TAG_DELIMITER = /[\s,]/

/** 앞뒤 공백과 앞쪽 `#` 을 뗀다. 비면 null */
export function cleanTag(raw: string) {
  const tag = raw.normalize('NFC').trim().replace(/^#+/, '').trim()
  return tag || null
}

/** 정리하고 중복을 뺀다 (처음 나온 순서 유지) */
export function cleanTags(raw: readonly string[]) {
  const out: string[] = []
  for (const value of raw) {
    const tag = cleanTag(value)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

export function sameTags(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((tag, i) => tag === b[i])
}

/** 메모가 이 태그를 가졌나 — 영문 대소문자는 가리지 않는다 */
export function hasTag(tags: readonly string[], wanted: string) {
  const w = wanted.toLowerCase()
  return tags.some((t) => t.toLowerCase() === w)
}

/** 검색어 → `#` 으로 시작하는 낱말은 태그, 나머지는 제목·본문에서 찾을 글자 */
export function parseSearchQuery(query: string) {
  const tags: string[] = []
  const words: string[] = []
  for (const word of query.trim().split(/\s+/)) {
    if (!word) continue
    const tag = word.startsWith('#') ? cleanTag(word) : null
    if (tag) tags.push(tag)
    else words.push(word)
  }
  return { tags: cleanTags(tags), text: words.join(' ') }
}
