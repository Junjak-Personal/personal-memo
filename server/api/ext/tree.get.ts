export default defineMemoHandler(async (event, store) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  return store.publicTree()
})
