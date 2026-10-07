export default defineMemoHandler((event, store) => store.get(memoIdParam(event)))
