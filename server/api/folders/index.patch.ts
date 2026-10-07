import { parseStrings } from '../../memo/input'

export default defineMemoHandler(async (event, store) => {
  const { path, name } = parseStrings(await readBody(event), ['path', 'name'])
  return store.renameFolder(path, name)
})
