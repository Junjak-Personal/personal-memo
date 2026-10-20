function htmlEntities(value: string) {
  return value.replace(/&(?:#(x[0-9a-f]+|[0-9]+)|(amp|quot|apos|lt|gt));/gi, (entity, numeric: string | undefined, named: string | undefined) => {
    if (named) return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' } as Record<string, string>)[named.toLowerCase()] ?? entity
    const code = numeric?.[0]?.toLowerCase() === 'x' ? Number.parseInt(numeric.slice(1), 16) : Number(numeric)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity
  })
}

/** Markdown 이미지와 HTML 표 안의 img src. 원본 위치를 보관해 경로 부분만 교체한다. */
export function imageRefs(content: string, conservative = false): Array<{ src: string; start: number; end: number }> {
  const source = content
  const htmlBlocks: string[] = []
  const blockTags = new Set(['table', 'div', 'section', 'article', 'aside', 'header', 'footer', 'blockquote', 'details', 'figure', 'ul', 'ol', 'li', 'p'])
  const refs: Array<{ src: string; start: number; end: number }> = []
  const markdown = /^!\[[^\]]*\]\(\s*(?:<([^<>\n]*)>|([^\s()]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/
  for (let i = 0; i < source.length; i++) {
    // HTML 태그/인용 속성을 먼저 소비하여 내부 문자열을 Markdown fence로 오인하지 않는다.
    if (!conservative && !htmlBlocks.length && (i === 0 || source[i - 1] === '\n')) {
      const lineEnd = source.indexOf('\n', i)
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(source.slice(i, lineEnd < 0 ? source.length : lineEnd).replace(/^(?: {0,3}> ?)+/, ''))
      if (marker && !(marker[1]![0] === '`' && marker[2]!.includes('`'))) {
        let cursor = lineEnd < 0 ? source.length : lineEnd + 1
        while (cursor < source.length) {
          const next = source.indexOf('\n', cursor)
          const closing = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/.exec(source.slice(cursor, next < 0 ? source.length : next).replace(/^(?: {0,3}> ?)+/, ''))
          if (closing && closing[1]![0] === marker[1]![0] && closing[1]!.length >= marker[1]!.length) { cursor = next < 0 ? source.length : next; break }
          cursor = next < 0 ? source.length : next + 1
        }
        i = cursor
        continue
      }
    }
    if (source[i] === '\\') { i++; continue }
    if (!conservative && !htmlBlocks.length && source[i] === '`') {
      let end = i + 1
      while (source[end] === '`') end++
      const run = source.slice(i, end)
      let close = source.indexOf(run, end)
      while (close !== -1 && (source[close - 1] === '`' || source[close + run.length] === '`')) close = source.indexOf(run, close + run.length)
      if (close !== -1) i = close + run.length - 1
      else i = end - 1
      continue
    }
    if (!conservative && source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4)
      i = close === -1 ? source.length : close + 2
      continue
    }
    if (source[i] === '<') {
      // 다른 태그의 속성 안에 적은 <img>나 Markdown 예시는 실제 이미지가 아니다.
      const tag = /^<\/?[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(source.slice(i))
      if (tag) {
        const raw = /^<(pre|code|script|style)\b/i.exec(tag[0])
        if (raw && !conservative) {
          const closing = new RegExp(`</${raw[1]}\\s*>`, 'ig')
          closing.lastIndex = i + tag[0].length
          const match = closing.exec(source)
          i = match ? match.index + match[0].length - 1 : source.length
          continue
        }
        const name = /^<\/?([a-z][a-z0-9:-]*)/i.exec(tag[0])?.[1]?.toLowerCase()
        if (name && blockTags.has(name)) {
          if (tag[0].startsWith('</')) { const index = htmlBlocks.lastIndexOf(name); if (index >= 0) htmlBlocks.splice(index) }
          else if (!tag[0].endsWith('/>')) htmlBlocks.push(name)
        }
        if (/^<img\b/i.test(tag[0])) {
          // 인용된 다른 속성의 값 속 src=를 이미지 경로로 오인하지 않는다.
          const attrs = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
          for (const attr of tag[0].matchAll(attrs)) {
            if (attr[1]!.toLowerCase() !== 'src') continue
            const src = attr[2] ?? attr[3] ?? attr[4]
            if (src) {
              const start = i + attr.index + attr[0].lastIndexOf(src)
              refs.push({ src: htmlEntities(src), start, end: start + src.length })
            }
            break
          }
        }
        i += tag[0].length - 1
        continue
      }
    }
    if ((!conservative && htmlBlocks.length) || source[i] !== '!' || source[i + 1] !== '[') continue
    const match = markdown.exec(source.slice(i))
    if (!match) continue
    const src = match[1] ?? match[2]!
    if (src) {
      const start = i + match[0].indexOf(src, match[0].indexOf('](') + 2)
      refs.push({ src, start, end: start + src.length })
    }
    i += match[0].length - 1
  }
  return refs.sort((a, b) => a.start - b.start)
}

/** 경로 부분만 뒤에서부터 바꾸므로 나머지 Markdown/HTML은 바뀌지 않는다. */
export function rewriteImageRefs(content: string, replacements: ReadonlyMap<string, string>) {
  let rewritten = content
  for (const ref of imageRefs(content).reverse()) {
    const replacement = replacements.get(ref.src)
    if (replacement) rewritten = rewritten.slice(0, ref.start) + replacement + rewritten.slice(ref.end)
  }
  return rewritten
}
