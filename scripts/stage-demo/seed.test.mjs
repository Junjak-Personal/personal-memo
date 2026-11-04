import assert from 'node:assert/strict'
import test from 'node:test'
import { demoMemos, seedDemo, stageOrigin } from './seed.mjs'

const now = new Date('2026-11-03T17:00:00Z')

function fakeApi() {
  const state = { folders: [], memos: [], requests: [] }
  const reply = (value, headers) => new Response(JSON.stringify(value), { headers })
  async function fetchImpl(url, options) {
    const path = new URL(url).pathname
    state.requests.push({ path, method: options.method, options })
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    if (path === '/api/auth/login') {
      return reply({ ok: true }, { 'set-cookie': 'memo-stage-session=test-cookie; Path=/; Secure; HttpOnly' })
    }
    assert.equal(options.headers.cookie, 'memo-stage-session=test-cookie')
    if (path === '/api/tree') return reply({ folders: state.folders, memos: state.memos })
    const input = JSON.parse(options.body)
    if (path === '/api/folders') {
      const folder = { path: input.name, name: input.name, children: [] }
      state.folders.push(folder)
      return reply(folder)
    }
    assert.equal(path, '/api/memos')
    assert.equal(options.method, 'POST')
    const memo = { ...input, id: `demo-${state.memos.length + 1}` }
    state.memos.push(memo)
    return reply(memo)
  }
  return { state, fetchImpl }
}

test('운영 및 다른 출처는 로그인 요청 전 거부한다', async () => {
  let requests = 0
  for (const url of [
    'https://memo.jun-devlog.win', 'http://127.0.0.1:4700', 'http://localhost:4710',
    'https://memo-test.jun-devlog.win.evil.test', 'https://memo-test.jun-devlog.win:444',
    'http://memo-test.jun-devlog.win', 'http://user:pass@localhost:4701',
    'http://localhost:4701/path', 'http://localhost:4701/?x=1', 'http://localhost:4701/#x',
  ]) {
    await assert.rejects(seedDemo({ url, fetchImpl: async () => { requests++; throw new Error('unexpected request') } }))
  }
  assert.equal(requests, 0)
})

test('stage URL만 정규화해 허용한다', () => {
  assert.equal(stageOrigin('http://127.0.0.1:4701/'), 'http://127.0.0.1:4701')
  assert.equal(stageOrigin('http://localhost:4701'), 'http://localhost:4701')
  assert.equal(stageOrigin('https://memo-test.jun-devlog.win/'), 'https://memo-test.jun-devlog.win')
})

test('견본은 KST 날짜·태그·미완료 및 완료 할 일을 포함한다', () => {
  const memos = demoMemos(now)
  assert.equal(memos.length, 15)
  assert.equal(new Set(memos.map(memo => memo.folder)).size, 5)
  assert.ok(memos.every(memo => memo.tags.length > 0))
  assert.ok(memos.some(memo => memo.done === false && memo.date === '2026-11-04'))
  assert.ok(memos.some(memo => memo.done === true && memo.date === '2026-11-03'))
  assert.ok(memos.some(memo => memo.done === false && !memo.date))
  assert.ok(memos.some(memo => memo.dateEnd === '2026-11-07'))
})

test('초회 시드는 인증 쿠키로 5개 폴더·15개 메모와 실제 내부 링크를 만든다', async () => {
  const { state, fetchImpl } = fakeApi()
  const result = await seedDemo({ fetchImpl, now })
  assert.deepEqual(result, { createdFolders: 5, createdMemos: 15, skippedMemos: 0 })
  const welcome = state.memos.find(memo => memo.title.startsWith('personal-memo'))
  const markdown = state.memos.find(memo => memo.title === '마크다운 편집을 연습해 보세요')
  assert.ok(welcome.content.includes(`](/m/${markdown.id})`))
  assert.ok(!state.requests.some(request => ['PATCH', 'PUT', 'DELETE'].includes(request.method)))
})

test('재실행은 기존 수정 내용과 완료 상태를 보존하고 추가 쓰기를 하지 않는다', async () => {
  const { state, fetchImpl } = fakeApi()
  await seedDemo({ fetchImpl, now })
  state.memos[0].content = '방문자가 직접 고친 내용'
  const todo = state.memos.find(memo => memo.done === false)
  todo.done = true
  state.requests.length = 0
  const result = await seedDemo({ fetchImpl, now: new Date('2026-11-05T00:00:00Z') })
  assert.deepEqual(result, { createdFolders: 0, createdMemos: 0, skippedMemos: 15 })
  assert.equal(state.memos[0].content, '방문자가 직접 고친 내용')
  assert.equal(todo.done, true)
  assert.deepEqual(state.requests.map(request => [request.method, request.path]), [['POST', '/api/auth/login'], ['GET', '/api/tree']])
})

test('로그인 실패는 시드를 시작하지 않고 응답의 민감한 본문을 오류에 넣지 않는다', async () => {
  let requests = 0
  await assert.rejects(seedDemo({ fetchImpl: async () => {
    requests++
    return new Response('sensitive-response-body', { status: 401 })
  } }), error => error.message.includes('HTTP 401') && !error.message.includes('sensitive-response-body'))
  assert.equal(requests, 1)
})

test('운영 세션 쿠키가 반환되면 로그인 뒤 데이터 접근 없이 중단한다', async () => {
  const requests = []
  await assert.rejects(seedDemo({ fetchImpl: async (url, options) => {
    requests.push([options.method, new URL(url).pathname])
    return new Response(JSON.stringify({ ok: true }), { headers: { 'set-cookie': 'memo-session=production-cookie; Path=/; Secure; HttpOnly' } })
  } }), /체험 환경 전용 세션 쿠키/)
  assert.deepEqual(requests, [['POST', '/api/auth/login']])
})
