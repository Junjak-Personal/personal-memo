import { templateNameInput } from '../../../memo/templates'

export default defineMemoHandler(async (event, store) => store.renameTemplate(memoIdParam(event), templateNameInput(await readBody(event))))
