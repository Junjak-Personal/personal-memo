import { parseUpdateInput } from '../../memo/input'

export default defineMemoHandler(async (event, store) => {
  const memo = await store.update(memoIdParam(event), parseUpdateInput(await readBody(event)))
  useCalendarSync()?.notify(memo)
  return memo
})
