import { MemoError } from '../../memo/errors'
import { parseNavigationInput } from '../../memo/navigation'

export default defineMemoHandler(async (event) => {
  const { value, id } = parseNavigationInput(await readBody(event))
  if (typeof value.favorite !== 'boolean') throw new MemoError('bad_request', 'favorite: true 또는 false여야 합니다')
  return (await useMemoNavigationStore()).favorite(id, value.favorite)
})
