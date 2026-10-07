import { parseStrings } from '../../../memo/input'

export default defineMemoHandler(async (event, store) => {
  const { folder } = parseStrings(await readBody(event), ['folder'])
  return store.move(memoIdParam(event), folder)
})
