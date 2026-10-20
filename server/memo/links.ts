import { isUlid } from '../../shared/utils/ulid'
import { MemoError } from './errors'
import { parseMemo } from './file'

/**
 * 경로 ID를 링크 대상으로 고를 때만 영구 ID를 넣는다. 편집기 왕복이나 YAML 전체 재직렬화를 하지 않아
 * 본문 바이트·알 수 없는 키/주석·기존 날짜의 표기를 바꾸지 않는다.
 */
export function withStableMemoId(raw: string, id: string): string {
  if (!isUlid(id)) throw new MemoError('bad_request', '영구 메모 ID가 잘못됐습니다')
  const parsed = parseMemo(raw)
  if (!parsed.ok) throw new MemoError('unreadable', 'frontmatter 를 읽을 수 없어 연결하지 않았습니다')
  const front = /^---(\r?\n)([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(raw)
  if (!front || front.index !== 0) return `---\nid: ${id}\n---\n\n${raw}`
  const newline = front[1]!
  const yaml = front[2]!
  const start = 3 + newline.length
  let next: string
  if (parsed.doc?.has('id')) {
    const node = parsed.doc.get('id', true)
    if (!node || typeof node !== 'object' || !('range' in node) || !Array.isArray(node.range)
      || node.range.length < 2 || typeof node.range[0] !== 'number' || typeof node.range[1] !== 'number'
      || 'anchor' in node && node.anchor) {
      // id의 anchor를 바꾸면 다른 키의 YAML alias 값까지 바뀔 수 있다.
      throw new MemoError('unreadable', '기존 ID를 안전하게 바꿀 수 없습니다. 파일의 id 항목을 먼저 확인해 주세요')
    }
    const [from, to] = node.range as [number, number]
    const ended = /(\r?\n)$/.exec(yaml.slice(from, to))?.[1] ?? ''
    next = yaml.slice(0, from) + (yaml[from - 1] === ':' ? ' ' : '') + id + ended + yaml.slice(to)
  } else {
    next = yaml + (yaml && !yaml.endsWith('\n') ? newline : '') + `id: ${id}${newline}`
  }
  const result = raw.slice(0, start) + next + raw.slice(start + yaml.length)
  const check = parseMemo(result)
  if (!check.ok || check.fields.id !== id) throw new MemoError('unreadable', '메모 ID를 안전하게 추가하지 못했습니다')
  return result
}
