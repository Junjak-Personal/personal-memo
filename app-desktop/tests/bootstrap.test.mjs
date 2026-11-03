import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const source = readFileSync(new URL('../frontend/bootstrap.js', import.meta.url), 'utf8')
const site = 'http://localhost:4710/'
function context(href) {
  const calls = []
  const window = { fetch: async (...args) => { calls.push(args); return 'response' } }
  const document = { addEventListener: (_name, callback) => callback(), getElementById: () => ({}) }
  vm.runInNewContext(source.replace('__MEMO_SITE__', JSON.stringify(site)), { URL, window, document, location: new URL(href) })
  return { window, calls }
}

test('세션·메모 API 요청은 이전 HTTP 캐시를 재사용하지 않고 기존 옵션을 보존한다', async () => {
  const { window, calls } = context(site)
  const options = { method: 'DELETE', credentials: 'same-origin', headers: { accept: 'application/json' } }
  assert.equal(await window.fetch('/api/_auth/session', options), 'response')
  assert.equal(calls[0][0], '/api/_auth/session')
  assert.equal(calls[0][1].method, options.method)
  assert.equal(calls[0][1].credentials, options.credentials)
  assert.equal(calls[0][1].headers, options.headers)
  assert.equal(calls[0][1].cache, 'no-store')
  assert.equal(options.cache, undefined)
})

test('Request의 본문·URL은 바꾸지 않는다', async () => {
  const { window, calls } = context(site)
  const request = new Request(`${site}api/memos`, { method: 'POST', body: 'fixture' })
  await window.fetch(request)
  assert.equal(calls[0][0], request)
  assert.equal(calls[0][1].cache, 'no-store')
  assert.equal(await request.text(), 'fixture')
})

test('외부 요청과 정적 자원의 캐시 옵션은 보존한다', async () => {
  const { window, calls } = context(site)
  const options = { cache: 'force-cache' }
  await window.fetch('https://example.com/api/session', options)
  await window.fetch('/memo-logo.png', options)
  assert.equal(calls[0][1], options)
  assert.equal(calls[1][1], options)
})

test('허용 출처가 아닌 페이지에는 fetch를 덮어쓰지 않는다', async () => {
  const { window, calls } = context('https://example.com/')
  await window.fetch('/api/session')
  assert.equal(calls[0][1], undefined)
})
