/** 본문 대신 쿼리로 받는다 — DELETE 본문은 중간 프록시가 버리는 일이 있다 */
export default defineMemoHandler(async (event, store) => {
  await store.deleteFolder(queryString(event, 'path'))
  return { ok: true }
})
