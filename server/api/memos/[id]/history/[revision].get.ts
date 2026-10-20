import { MemoError } from '../../../../memo/errors'

export default defineMemoHandler(async (event, store) => {
  const revision = getRouterParam(event, 'revision', { decode: true })
  if (!revision) throw new MemoError('bad_request', '수정 이력 ID가 없습니다')
  return store.getRevision(memoIdParam(event), revision)
})
