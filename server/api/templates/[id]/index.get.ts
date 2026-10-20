export default defineMemoHandler(async (event, store) => store.getTemplate(memoIdParam(event)))
