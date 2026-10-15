/** 모든 AI 연결 끊기 — 서명 키도 바꿔 이미 나간 접근 토큰까지 바로 무효 */
export default defineEventHandler(async () => {
  await (await useOAuthGrants()).revokeAll()
  console.info('[mcp] 모든 연결을 끊었습니다')
  return { ok: true }
})
