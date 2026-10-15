/**
 * 외부 공개 메모 (설계문서 §11.2) — 로그인 없이 연다(server/middleware/auth.ts 가 /api/ext/ 를 연다).
 * 제목·본문·수정 시각만 준다. 공개하지 않았거나 없는 메모는 똑같이 404.
 */
export default defineMemoHandler(async (event, store) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  return store.publicMemo(memoIdParam(event))
})
