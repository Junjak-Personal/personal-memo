/** 휴지통으로 옮긴다. 화면의 「되돌리기」가 쓸 휴지통 안 경로를 돌려준다 */
export default defineMemoHandler(async (event, store) => {
  const id = memoIdParam(event)
  const result = await store.remove(id)
  useCalendarSync()?.notifyRemoved(id)
  return result
})
