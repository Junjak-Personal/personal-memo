// 구글 캘린더 연동 스모크 (설계문서 §8.3) — 앱 API 로 메모를 바꾸고, 실제 캘린더에 맞게 반영되는지 본다.
//
// 🔴 사용자 데이터·운영 캘린더를 건드리지 않게 이 순서를 지킨다.
//   1. 떠 있는 dev 서버를 멈춘다 (.nuxt 를 같이 써서 같은 폴더에서 둘을 못 띄운다)
//   2. 별도 dotenv 로 시험 서버를 띄운다 — .env.local 은 읽지 않는다
//        NUXT_SESSION_PASSWORD, NUXT_ADMIN_PASSWORD_HASH  (.env.local 과 같은 값)
//        NUXT_DATA_DIR=<빈 임시 폴더>
//        NUXT_SITE_URL=<설명에 넣을 주소>
//        NUXT_GOOGLE_CALENDAR_ID, NUXT_GOOGLE_SERVICE_ACCOUNT_FILE
//      pnpm exec nuxt dev --dotenv <그 파일>
//   3. 이 스크립트를 돌린다
//        SMOKE_KEY_FILE=<키 파일> SMOKE_CALENDAR_ID=<캘린더> SMOKE_DATA_DIR=<2의 임시 폴더> \
//        SMOKE_SITE_URL=<2의 NUXT_SITE_URL> E2E_PASSWORD=<로그인 비밀번호> node scripts/calendar-smoke/smoke.mjs
//   4. 시험 서버를 멈추고 원래 dev 서버(pnpm dev)를 다시 띄운다
//
// 안전장치: 시험 서버가 임시 폴더에 붙지 않았거나(메모가 보임), 캘린더에 이미 메모 일정(memoId)이 있으면
// 아무것도 하지 않고 멈춘다 — 운영 캘린더일 수 있다. 만든 일정은 끝에 전부 지우고 시작 때 일정 수로 돌아왔는지 본다.
// 운영이 생긴 뒤에는 시험용 캘린더를 따로 만들어 쓴다.
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connect, memoIdOf } from './google.mjs'

const env = (name, fallback) => {
  const value = process.env[name] ?? fallback
  if (value === undefined) throw new Error(`${name} 가 없습니다 (파일 머리 주석 참고)`)
  return value
}
const KEY_FILE = env('SMOKE_KEY_FILE')
const CALENDAR_ID = env('SMOKE_CALENDAR_ID')
const DATA_DIR = env('SMOKE_DATA_DIR')
const PASSWORD = env('E2E_PASSWORD')
const BASE = env('SMOKE_BASE', 'http://localhost:4700')
const SITE = env('SMOKE_SITE_URL', '')

let cookie = ''
const results = []
const check = (label, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function http(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

/** 조건이 맞을 때까지 1초마다 본다 — 저장 뒤 대조는 2초 디바운스 + 구글 왕복이다 */
async function until(fn, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    last = await fn()
    if (last.ok) return last
    await sleep(1000)
  }
  return last
}

const g = await connect(KEY_FILE, CALENDAR_ID)
const memoIds = new Set()
const foreignIds = []
let startCount = null
const ours = async () => (await g.list()).filter((e) => memoIds.has(memoIdOf(e))).length
const eventsOf = async (memoId) => (await g.list()).filter((e) => memoIdOf(e) === memoId)
const syncNow = (allowMassDelete = false) => http('POST', '/api/calendar/sync', { allowMassDelete })
async function create(title, date, dateEnd = null) {
  const memo = await http('POST', '/api/memos', { folder: '', title, content: '스모크 본문', date, dateEnd })
  memoIds.add(memo.id)
  return memo
}
const memoPath = async (id) => (await http('GET', '/api/tree')).memos.find((m) => m.id === id).path

try {
  for (let i = 0; i < 60; i++) {
    try {
      await http('GET', '/api/health')
      break
    } catch {
      await sleep(1000)
    }
  }
  await http('POST', '/api/auth/login', { password: PASSWORD })
  const tree = await http('GET', '/api/tree')
  if (tree.memos.length) throw new Error(`시험 서버에 메모 ${tree.memos.length}개가 보인다 — 임시 데이터 폴더가 아니다. 중단`)
  const before = await g.list()
  if (before.some(memoIdOf)) throw new Error('캘린더에 이미 메모 일정이 있다 — 운영 캘린더일 수 있다. 중단')
  startCount = before.length
  check('시험 서버·캘린더 확인', true, `메모 0개, 캘린더 일정 ${startCount}건(메모 일정 0)`)
  const s0 = await http('GET', '/api/calendar/sync')
  check('연동 켜짐', s0.state === 'on', s0.state)

  // 1. 만들기 — 저장 직후 자동 반영
  const a = await create('[스모크] 기간', '2026-10-20', '2026-10-22')
  const r1 = await until(async () => {
    const evs = await eventsOf(a.id)
    return { ok: evs.length === 1, evs }
  })
  const e1 = r1.evs?.[0]
  check('저장 후 자동 생성', r1.ok, e1 ? `${e1.start?.date} ~ ${e1.end?.date}(미포함)` : '없음')
  check('끝 날짜 +1', e1?.start?.date === '2026-10-20' && e1?.end?.date === '2026-10-23')
  check('설명에 메모 주소', e1?.description === (SITE ? `${SITE.replace(/\/+$/, '')}/m/${a.id}` : ''), e1?.description)
  check('한가함(transparent)', e1?.transparency === 'transparent', e1?.transparency)

  // 2. 제목·날짜 고치기 — 같은 일정을 고친다
  const a2 = await http('PUT', `/api/memos/${a.id}`, {
    baseVersion: a.version,
    title: '[스모크] 고침',
    content: '스모크 본문',
    date: '2026-10-21',
    dateEnd: null,
  })
  const r2 = await until(async () => {
    const evs = await eventsOf(a.id)
    return { ok: evs.length === 1 && evs[0].summary === '[스모크] 고침' && evs[0].start?.date === '2026-10-21', evs }
  })
  check('수정 반영 (같은 일정 id)', r2.ok && r2.evs[0].id === e1?.id, `${r2.evs?.[0]?.summary} ${r2.evs?.[0]?.start?.date} ~ ${r2.evs?.[0]?.end?.date}`)

  // 3. 구글에서 시간 일정으로 바꾼 것 → 종일로 되돌린다
  await g.api('PATCH', `/${e1.id}`, {
    start: { dateTime: '2026-10-21T10:00:00+09:00', date: null },
    end: { dateTime: '2026-10-21T11:00:00+09:00', date: null },
  })
  await syncNow()
  const [e3] = await eventsOf(a.id)
  check('시간 일정 → 종일로 복구', e3?.start?.date === '2026-10-21' && !e3?.start?.dateTime && e3?.end?.date === '2026-10-22')

  // 4. 같은 memoId 일정이 둘 → 하나만 남는다
  await g.api('POST', '', { summary: '[스모크] 중복', start: { date: '2026-10-01' }, end: { date: '2026-10-02' }, extendedProperties: { private: { memoId: a.id } } })
  await syncNow()
  const e4 = await eventsOf(a.id)
  check('중복 정리', e4.length === 1 && e4[0].id === e1.id, `${e4.length}건`)

  // 5. memoId 없는 일정은 손대지 않는다
  const foreign = await g.api('POST', '', { summary: '[스모크] 사람이 만든 일정', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } })
  foreignIds.push(foreign.id)
  await syncNow()
  check('memoId 없는 일정 유지', (await g.list()).some((e) => e.id === foreign.id))

  // 6. 날짜 지우기 → 일정 삭제
  await http('PUT', `/api/memos/${a.id}`, { baseVersion: a2.version, title: '[스모크] 고침', content: '스모크 본문', date: null, dateEnd: null })
  check('날짜 지우면 일정 삭제', (await until(async () => ({ ok: (await eventsOf(a.id)).length === 0 }))).ok)

  // 7. 휴지통 → 삭제, 되살리기 → 다시 생성
  const b = await create('[스모크] 휴지통', '2026-10-25')
  const r7a = await until(async () => ({ ok: (await eventsOf(b.id)).length === 1 }))
  const { trashPath } = await http('DELETE', `/api/memos/${b.id}`)
  const r7b = await until(async () => ({ ok: (await eventsOf(b.id)).length === 0 }))
  await http('POST', '/api/trash/restore', { path: trashPath })
  const r7c = await until(async () => ({ ok: (await eventsOf(b.id)).length === 1 }))
  check('휴지통 → 삭제 → 되살리기 → 생성', r7a.ok && r7b.ok && r7c.ok, `${r7a.ok}/${r7b.ok}/${r7c.ok}`)

  // 8. 대량 삭제 차단 — 파일을 밖에서 5개 지운다 (메모 일정 6개 중 5개)
  const many = []
  for (let i = 1; i <= 5; i++) many.push(await create(`[스모크] 대량 ${i}`, `2026-11-0${i}`))
  await syncNow()
  check('대량 준비: 메모 일정 6개', (await ours()) === 6)
  for (const m of many) await rm(join(DATA_DIR, 'memos', m.path))
  const s8 = await syncNow()
  check('절반 넘는 삭제는 보류', s8.held?.reason === 'many' && s8.held?.deletes === 5 && (await ours()) === 6, JSON.stringify(s8.held))
  const s8b = await syncNow(true)
  check('확인하면 지운다', s8b.held === null && (await ours()) === 1)

  // 9. 메모 파일이 하나도 없으면(데이터 폴더가 빠진 서버) 지우지 않는다 — 휴지통도 비어 있어야 한다
  await rm(join(DATA_DIR, 'memos', await memoPath(b.id)))
  await rm(join(DATA_DIR, 'memos', await memoPath(a.id)))
  const s9 = await syncNow()
  check('빈 폴더는 삭제 보류', s9.held?.reason === 'empty' && (await ours()) === 1, JSON.stringify(s9.held))
  const s9b = await syncNow(true)
  check('확인하면 지운다 (빈 폴더)', s9b.held === null && (await ours()) === 0)
  check('상태에 실패 없음', Object.keys(s9b.failures).length === 0 && s9b.error === null, JSON.stringify({ f: s9b.failures, e: s9b.error }))
} catch (e) {
  check('스모크 중단', false, e.message)
} finally {
  // 정리 — 이번에 만든 memoId 일정과 사람 일정 흉내만 지운다
  if (startCount !== null) {
    for (const e of await g.list()) {
      if (memoIds.has(memoIdOf(e)) || foreignIds.includes(e.id)) await g.api('DELETE', `/${e.id}`)
    }
    const left = (await g.list()).length
    check('정리 후 시작 때 일정 수로 돌아옴', left === startCount, `${left}건 (시작 ${startCount}건)`)
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} 통과`)
  process.exitCode = results.every(Boolean) ? 0 : 1
}
