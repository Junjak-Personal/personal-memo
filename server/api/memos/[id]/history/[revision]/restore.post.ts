import { parseStrings } from '../../../../../memo/input'
import { MemoError } from '../../../../../memo/errors'

export default defineMemoHandler(async (event, store) => {
  const revision = getRouterParam(event, 'revision', { decode: true })
  if (!revision) throw new MemoError('bad_request', '수정 이력 ID가 없습니다')
  const { baseVersion } = parseStrings(await readBody(event), ['baseVersion'])
  const memo = await store.restoreRevision(memoIdParam(event), revision, baseVersion)
  useCalendarSync()?.notify(memo)
  return memo
})
