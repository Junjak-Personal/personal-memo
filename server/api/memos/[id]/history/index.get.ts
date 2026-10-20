export default defineMemoHandler(async (event, store) => store.getRevisions(memoIdParam(event)))
