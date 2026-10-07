import { parseStrings } from '../../memo/input'

/** 폴더를 다른 폴더 안으로 (parent 가 빈 문자열이면 최상위로) */
export default defineMemoHandler(async (event, store) => {
  const { path, parent } = parseStrings(await readBody(event), ['path', 'parent'])
  return store.moveFolder(path, parent)
})
