import { parsePublicInput, parseStrings } from '../../memo/input'

export default defineMemoHandler(async (event, store) => {
  const body = await readBody(event)
  const { path } = parseStrings(body, ['path'])
  return store.setFolderPublic(path, parsePublicInput(body))
})
