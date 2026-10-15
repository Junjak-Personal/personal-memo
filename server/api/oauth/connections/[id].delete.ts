/** 연결 하나 끊기 — 그 연결의 갱신 토큰을 지우고, 이미 나간 접근 토큰도 바로 무효 */
export default defineEventHandler(async (event) => {
  await (await useOAuthGrants()).revoke(getRouterParam(event, 'id') ?? '')
  return { ok: true }
})
