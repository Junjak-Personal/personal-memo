import { isLoopback } from '../../../oauth/client'

/** 승인 화면이 보여 줄 것 — 어느 앱이, 어디로 돌아가려 하는지. /api 아래라 앱에 로그인한 사람만 읽는다 */
export default defineEventHandler(async (event) => {
  const request = (await useOAuthGrants()).getRequest(getRouterParam(event, 'id') ?? '')
  if (!request) throw createError({ statusCode: 404, data: { message: '승인 요청이 없거나 만료됐습니다. AI 앱에서 다시 연결하세요.' } })
  return {
    clientHost: request.clientHost,
    clientId: request.clientId,
    redirectHost: new URL(request.redirectUri).host,
    /** 이 컴퓨터의 프로그램(Claude Code 등)으로 돌아간다 — 아무 프로그램이나 그 포트를 열 수 있어 따로 경고한다 */
    loopback: isLoopback(request.redirectUri),
  }
})
