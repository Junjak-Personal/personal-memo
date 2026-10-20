import { navigationId, parseNavigationInput } from '../../memo/navigation'

export default defineMemoHandler(async (event) => {
  const { value, id } = parseNavigationInput(await readBody(event))
  const previousId = value.previousId === undefined ? undefined : navigationId(value.previousId)
  return (await useMemoNavigationStore()).opened(id, previousId)
})
