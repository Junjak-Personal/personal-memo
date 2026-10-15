import { parsePublicInput } from '../../../memo/input'

/**
 * 외부 공개 켜기·끄기 — `{ public: true | false }`. frontmatter 의 `public` 만 바꾼다 (설계문서 §11.2).
 * 켜면 `/ext/{id}` 를 누구나 로그인 없이 읽기 전용으로 연다. 끄면 바로 막힌다.
 */
export default defineMemoHandler(async (event, store) => {
  const memo = await store.setPublic(memoIdParam(event), parsePublicInput(await readBody(event)))
  console.info(`[ext] ${memo.public ? '공개' : '공개 해제'} ${memo.id}`)
  return memo
})
