export default defineMemoHandler((event, store) => store.calendar(queryString(event, 'from'), queryString(event, 'to')))
