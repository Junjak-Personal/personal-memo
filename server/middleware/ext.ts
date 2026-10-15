/**
 * 외부 공개 화면(/ext/{id})과 그 API(/api/ext/) — 검색엔진에 올리지 않고, 본문 속 링크를 눌러도 공개 주소를 남의 사이트에
 * 넘기지 않는다 (설계문서 §11.2). 주소를 아는 사람만 보는 공유다.
 */
export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/ext/') && !path.startsWith('/api/ext/')) return
  setResponseHeaders(event, {
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': 'no-referrer',
  })
})
