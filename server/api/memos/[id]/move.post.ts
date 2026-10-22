import { parseStrings } from '../../../memo/input'

/** 「할 일」 폴더로 들어가거나 나가면 할 일 상태가 바뀐다 — 날짜 있는 메모면 구글 일정도 따라 바뀐다 (notify 가 isScheduled 로 판단) */
export default defineMemoHandler(async (event, store) => {
  const { folder } = parseStrings(await readBody(event), ['folder'])
  const memo = await store.move(memoIdParam(event), folder)
  useCalendarSync()?.notify(memo)
  return memo
})
