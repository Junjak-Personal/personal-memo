export default defineMemoHandler(async (event, store) => {
  await store.removeTemplate(memoIdParam(event))
  setResponseStatus(event, 204)
  return null
})
