export default defineEventHandler(async (event) => {
  assertLoginAllowed()
  const { adminPasswordHash } = useRuntimeConfig()
  if (!adminPasswordHash) {
    throw createError({ statusCode: 500, statusMessage: 'no_password', message: 'ADMIN_PASSWORD_HASH 가 설정되지 않았습니다' })
  }

  const body = await readBody<{ password?: unknown }>(event)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password) {
    throw createError({ statusCode: 400, statusMessage: 'bad_request', message: '비밀번호를 입력하세요', data: { message: '비밀번호를 입력하세요' } })
  }

  if (!(await verifyPassword(adminPasswordHash, password))) {
    recordLoginFailure()
    // 무차별 대입 속도를 늦춘다. 타이밍 안전 비교는 @adonisjs/hash 가 한다
    await new Promise((r) => setTimeout(r, 400))
    throw createError({ statusCode: 401, statusMessage: 'wrong_password', message: '비밀번호가 맞지 않습니다', data: { message: '비밀번호가 맞지 않습니다' } })
  }

  recordLoginSuccess()
  await setUserSession(event, { user: { owner: true }, loggedInAt: Date.now() })
  return { ok: true }
})
