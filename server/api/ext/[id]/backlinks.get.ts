export default defineMemoHandler((event, store) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  return store.publicBacklinks(memoIdParam(event))
})
