import { templateFolderInput } from '../../../memo/templates'

export default defineMemoHandler(async (event, store) => {
  const memo = await store.createFromTemplate(memoIdParam(event), templateFolderInput(await readBody(event)))
  setResponseStatus(event, 201)
  return memo
})
