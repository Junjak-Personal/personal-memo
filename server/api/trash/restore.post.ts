import { parseStrings } from '../../memo/input'

export default defineMemoHandler(async (event, store) => {
  const { path } = parseStrings(await readBody(event), ['path'])
  const memo = await store.restore(path)
  useCalendarSync()?.notify(memo)
  return memo
})
