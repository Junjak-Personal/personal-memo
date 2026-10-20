/**
 * 지원하는 HTML 표의 tbody 삽입·셀 안 p 감싸기를 같게 비교한다. 파싱/보안 허용 범위를 바꾸지 않는다.
 * 지원하지 않는 태그/속성이 하나라도 있으면 원문을 반환해 기존 형식 손실 경고를 유지한다.
 */
export function canonicalHtmlTables(markdown: string): string {
  if (typeof window === 'undefined' || !window.DOMParser) return markdown
  // 코드 펜스 안의 HTML은 문서가 아니라 글자다. 형식 손실 검사를 건너뛰는 데 쓰이면 안 된다.
  const fences: [number, number][] = []
  let fence: { marker: string; length: number; start: number } | null = null
  let position = 0
  for (const line of markdown.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (match) {
      const marker = match[1]![0]!
      if (!fence && !(marker === '`' && match[2]!.includes('`'))) fence = { marker, length: match[1]!.length, start: position }
      else if (fence && marker === fence.marker && match[1]!.length >= fence.length && !match[2]!.trim()) {
        fences.push([fence.start, position + line.length])
        fence = null
      }
    }
    position += line.length + 1
  }
  if (fence) fences.push([fence.start, markdown.length])
  function canonicalTable(html: string): string {
    const parsed = new window.DOMParser().parseFromString(html, 'text/html')
    const table = parsed.body.firstElementChild
    if (!table || table.tagName !== 'TABLE' || parsed.body.children.length !== 1 || table.querySelector('table')) return html
    let safe = true
    const structural = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR'])
    const inline = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'CODE', 'BR', 'A'])
    function signature(node: ChildNode): unknown {
      if (node.nodeType === 3) return node.textContent
      if (node.nodeType !== 1) { safe = false; return null }
      const el = node as Element
      const tag = el.tagName
      if (!structural.has(tag) && !['TD', 'TH', 'P'].includes(tag) && !inline.has(tag)) safe = false
      const attrs: Record<string, string> = {}
      for (const attr of el.attributes) {
        if (tag === 'TABLE' && attr.name === 'data-memo-table' && attr.value === 'html') continue
        if ((tag === 'TD' || tag === 'TH') && ['colspan', 'rowspan'].includes(attr.name) && /^\d+$/.test(attr.value) && Number(attr.value) >= 1 && Number(attr.value) <= 1000) {
          if (Number(attr.value) > 1) attrs[attr.name] = String(Number(attr.value))
        } else if (tag === 'A' && ['href', 'title', 'target', 'rel'].includes(attr.name)) {
          if (attr.name === 'target' && attr.value === '_blank') continue
          if (attr.name === 'rel' && attr.value === 'noopener noreferrer nofollow') continue
          attrs[attr.name] = attr.value
        } else safe = false
      }
      let children = [...el.childNodes].filter(child => !(structural.has(tag) && child.nodeType === 3 && !child.textContent?.trim()))
      // td의 단일 p는 에디터가 필수로 감싼 textblock이다. 여러 문단/줄바꿈은 보존한다.
      if (['TD', 'TH'].includes(tag) && el.children.length === 1 && el.firstElementChild?.tagName === 'P' && children.length === 1 && !el.firstElementChild.attributes.length) children = [...el.firstElementChild.childNodes]
      const content = children.map(signature)
      if (['THEAD', 'TBODY', 'TFOOT'].includes(tag)) return content
      const flattened = tag === 'TABLE' ? content.flat() : content
      return [({ B: 'STRONG', I: 'EM', DEL: 'S' } as Record<string, string>)[tag] ?? tag, Object.entries(attrs).sort(), flattened]
    }
    const value = signature(table)
    return safe ? `\u001eHTML_TABLE:${JSON.stringify(value)}\u001e` : html
  }
  return markdown.replace(/(^|\n)( {0,3}<table(?:\s[^>]*)?>[\s\S]*?<\/table>)/gi, (full, prefix: string, html: string, offset: number) => {
    if (fences.some(([start, end]) => offset + prefix.length >= start && offset + prefix.length < end)) return full
    return prefix + canonicalTable(html)
  })
}
