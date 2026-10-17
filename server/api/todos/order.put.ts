import { parseTodoOrderInput } from '../../memo/input'

/** 「할 일」 화면의 순서 — `{ ids }`. 최상위 `.order.json` 의 todos (설계문서 §3.6) */
export default defineMemoHandler(async (event, store) => ({ ids: await store.setTodoOrder(parseTodoOrderInput(await readBody(event))) }))
