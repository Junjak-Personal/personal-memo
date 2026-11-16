export type RevisionDiffLine =
  | { kind: 'equal' | 'removed' | 'added'; text: string }
  | { kind: 'context'; count: number }

const MAX_DIFF_CELLS = 300_000
const MAX_DISPLAY_LINES = 600

/** 선택한 버전 → 현재 저장 내용. 큰 변경 구간은 묶어서 비교해 메모리 사용을 제한한다. */
export function diffMemoLines(before: string, after: string) {
  const lines: RevisionDiffLine[] = []
  if (before === after) return { lines, added: 0, removed: 0, coarse: false, truncated: false }
  const oldLines = before ? before.replace(/\r\n/g, '\n').split('\n') : []
  const newLines = after ? after.replace(/\r\n/g, '\n').split('\n') : []
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++
  let suffix = 0
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]) suffix++
  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix)
  const newMiddle = newLines.slice(prefix, newLines.length - suffix)
  let added = 0
  let removed = 0
  let truncated = false
  function record(kind: 'equal' | 'removed' | 'added', text: string) {
    if (kind === 'added') added++
    if (kind === 'removed') removed++
    if (lines.length < MAX_DISPLAY_LINES) lines.push({ kind, text })
    else truncated = true
  }
  if (prefix > 3) lines.push({ kind: 'context', count: prefix - 3 })
  for (const text of oldLines.slice(Math.max(0, prefix - 3), prefix)) record('equal', text)
  const width = newMiddle.length + 1
  const coarse = (oldMiddle.length + 1) * width > MAX_DIFF_CELLS
  if (coarse) {
    for (const text of oldMiddle) record('removed', text)
    for (const text of newMiddle) record('added', text)
  } else {
    const table = new Uint32Array((oldMiddle.length + 1) * width)
    for (let oldIndex = oldMiddle.length - 1; oldIndex >= 0; oldIndex--) {
      for (let newIndex = newMiddle.length - 1; newIndex >= 0; newIndex--) {
        const index = oldIndex * width + newIndex
        table[index] = oldMiddle[oldIndex] === newMiddle[newIndex]
          ? table[index + width + 1]! + 1
          : Math.max(table[index + width]!, table[index + 1]!)
      }
    }
    let oldIndex = 0
    let newIndex = 0
    while (oldIndex < oldMiddle.length || newIndex < newMiddle.length) {
      if (oldIndex < oldMiddle.length && newIndex < newMiddle.length && oldMiddle[oldIndex] === newMiddle[newIndex]) {
        record('equal', oldMiddle[oldIndex++]!)
        newIndex++
      } else if (oldIndex < oldMiddle.length && (newIndex === newMiddle.length || table[(oldIndex + 1) * width + newIndex]! >= table[oldIndex * width + newIndex + 1]!)) record('removed', oldMiddle[oldIndex++]!)
      else record('added', newMiddle[newIndex++]!)
    }
  }
  for (const text of oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + Math.min(3, suffix))) record('equal', text)
  if (suffix > 3 && lines.length < MAX_DISPLAY_LINES) lines.push({ kind: 'context', count: suffix - 3 })
  return { lines, added, removed, coarse, truncated }
}
