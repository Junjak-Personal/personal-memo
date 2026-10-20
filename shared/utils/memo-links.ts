import { isUlid } from './ulid'

/** 내부 링크는 한 origin의 정확한 메모 경로만 허용한다. 외부 주소·쿼리·경로 ID는 저장하지 않는다. */
export function memoLinkId(href: unknown): string | null {
  if (typeof href !== 'string' || href.length > 256) return null
  const match = /^\/m\/([^/?#]+)$/.exec(href)
  if (!match) return null
  try {
    const id = decodeURIComponent(match[1]!)
    return isUlid(id) ? id : null
  } catch { return null }
}

export function memoLinkHref(id: string): string {
  if (!isUlid(id)) throw new RangeError('내부 링크에는 영구 메모 ID가 필요합니다')
  return `/m/${encodeURIComponent(id)}`
}

/** fenced/indented code와 inline code를 같은 길이의 공백으로 가려 링크를 오판하지 않는다. */
function withoutCode(source: string): string {
  let fence: { marker: string; length: number } | null = null
  let indented = false
  let blank = true
  const lines = source.split('\n').map(line => {
    const body = line.replace(/^(?: {0,3}> ?)+/, '')
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body)
    if (fence) {
      if (marker && marker[1]![0] === fence.marker && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = null
      return ' '.repeat(line.length)
    }
    if (marker && !(marker[1]![0] === '`' && marker[2]!.includes('`'))) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length }
      return ' '.repeat(line.length)
    }
    const isBlank = !body.trim()
    const code = /^(?: {4}|\t)/.test(body) && (blank || indented)
    indented = code || indented && isBlank
    blank = isBlank
    return code ? ' '.repeat(line.length) : line
  }).join('\n')
  const out = lines.split('')
  for (let i = 0; i < lines.length;) {
    if (lines[i] === '\\') { i += 2; continue }
    if (lines[i] !== '`') { i++; continue }
    let end = i + 1
    while (lines[end] === '`') end++
    const run = lines.slice(i, end)
    let close = lines.indexOf(run, end)
    while (close !== -1 && (lines[close - 1] === '`' || lines[close + run.length] === '`')) close = lines.indexOf(run, close + run.length)
    if (close === -1) { i = end; continue }
    for (let at = i; at < close + run.length; at++) if (out[at] !== '\n') out[at] = ' '
    i = close + run.length
  }
  return out.join('')
}

function htmlEnd(source: string, start: number) {
  let quote = ''
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i]!
    if (quote) { if (char === quote) quote = '' }
    else if (char === '"' || char === "'") quote = char
    else if (char === '>') return i
  }
  return -1
}

function htmlHref(tag: string) {
  const match = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '').replace(/&(?:amp|quot|apos|lt|gt);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[entity] ?? entity) : null
}

/** 표준 Markdown/HTML 표의 실제 링크만 모은다. 본문·제목은 별도 인덱스에 복제하지 않는다. */
export function extractMemoLinkIds(markdown: string): Set<string> {
  const source = withoutCode(markdown)
  const ids = new Set<string>()
  const brackets: Array<{ image: boolean }> = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (source[i] === '<' && /[a-z/]/i.test(source[i + 1] ?? '')) {
      const end = htmlEnd(source, i)
      if (end === -1) break
      const tag = source.slice(i, end + 1)
      const raw = /^<(pre|code|script|style)\b/i.exec(tag)
      if (raw) {
        const closing = new RegExp(`</${raw[1]}\\s*>`, 'ig')
        closing.lastIndex = end + 1
        const match = closing.exec(source)
        i = match ? match.index + match[0].length - 1 : source.length
        continue
      }
      if (/^<a\b/i.test(tag) && !brackets.some(parent => parent.image)) {
        const id = memoLinkId(htmlHref(tag))
        if (id) ids.add(id)
      }
      i = end
      continue
    }
    if (source[i] === '!' && source[i + 1] === '[') { brackets.push({ image: true }); i++; continue }
    if (source[i] === '[') { brackets.push({ image: false }); continue }
    if (source[i] !== ']') continue
    const label = brackets.pop()
    if (!label || source[i + 1] !== '(') continue
    const destination = /^\(\s*(?:<([^<>\n]*)>|([^\s()]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/.exec(source.slice(i + 1))
    if (!destination) continue
    const insideImage = brackets.some(parent => parent.image)
    if (!label.image && !insideImage) {
      const id = memoLinkId(destination[1] ?? destination[2])
      if (id) ids.add(id)
    }
    // 중첩된 실제 링크는 Markdown에서 바깥 링크를 끝낸다. 겹친 링크를 중복 인덱싱하지 않는다.
    if (!label.image && !insideImage) brackets.length = 0
    i += destination[0].length
  }
  return ids
}
