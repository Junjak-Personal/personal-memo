export default defineMemoHandler((event, store) => store.search(queryString(event, 'q').slice(0, 200)))
