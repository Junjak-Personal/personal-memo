import { parseCreateInput } from '../../memo/input'

export default defineMemoHandler(async (event, store) => {
  const memo = await store.create(parseCreateInput(await readBody(event)))
  useCalendarSync()?.notify(memo)
  setResponseStatus(event, 201)
  return memo
})
