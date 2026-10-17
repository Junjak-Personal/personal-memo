import { parseOrderInput } from '../../memo/input'

/**
 * 폴더 안의 순서 — `{ folder, folders?, memos? }`. 그 폴더의 `.order.json` 만 바꾼다 (설계문서 §3.6).
 * 메모 파일은 건드리지 않는다 — 열린 편집기의 버전도 그대로다.
 */
export default defineMemoHandler(async (event, store) => {
  const { folder, patch } = parseOrderInput(await readBody(event))
  return store.setOrder(folder, patch)
})
