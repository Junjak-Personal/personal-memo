import { parsePriorityInput } from '../../../memo/input'

/** 할 일 중요도 — `{ priority: 'high' | 'medium' | 'low' }`. frontmatter 의 `priority` 만 바꾼다. 할 일이 아니면 거절 */
export default defineMemoHandler(async (event, store) => store.setPriority(memoIdParam(event), parsePriorityInput(await readBody(event))))
