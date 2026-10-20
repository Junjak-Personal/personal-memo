import { templateSaveInput } from '../../memo/templates'

export default defineMemoHandler(async (event, store) => {
  const { memoId, name, baseVersion } = templateSaveInput(await readBody(event))
  const template = await store.saveTemplate(memoId, name, baseVersion)
  setResponseStatus(event, 201)
  return template
})
