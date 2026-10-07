import { parseDoneInput } from '../../../memo/input'

/**
 * 할 일 체크 — `{ done: true | false | null }` (null = 할 일 해제). frontmatter 의 `done` 만 바꾼다.
 * 끝나면 구글 일정이 지워지고, 다시 풀면 다시 생긴다 (notify 가 isScheduled 로 판단).
 */
export default defineMemoHandler(async (event, store) => {
  const memo = await store.setDone(memoIdParam(event), parseDoneInput(await readBody(event)))
  useCalendarSync()?.notify(memo)
  return memo
})
