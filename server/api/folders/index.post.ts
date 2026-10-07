import { parseStrings } from '../../memo/input'

export default defineMemoHandler(async (event, store) => {
  const { parent, name } = parseStrings(await readBody(event), ['parent', 'name'])
  return store.createFolder(parent, name)
})
