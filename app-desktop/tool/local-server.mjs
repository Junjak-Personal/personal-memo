/** 실제 data/·계정·캘린더를 쓰지 않는 loopback 전용 수동 시험 서버. */
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { Hash } from '@adonisjs/hash'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'

const root = fileURLToPath(new URL('../../', import.meta.url))
const password = process.env.MEMO_DESKTOP_TEST_PASSWORD
if (!password) throw new Error('MEMO_DESKTOP_TEST_PASSWORD에 이 로컬 시험에서만 쓸 임시 비밀번호를 지정하세요')
const dir = resolve(root, '_workspace/desktop-local')
await mkdir(resolve(dir, 'data'), { recursive: true })
const hash = await new Hash(new Scrypt({})).make(password)
const dotenv = resolve(dir, '.env.test')
const config = {
  NUXT_DATA_DIR: resolve(dir, 'data'),
  NUXT_ADMIN_PASSWORD_HASH: hash,
  NUXT_SESSION_PASSWORD: randomBytes(48).toString('hex'),
  NUXT_GOOGLE_CALENDAR_ID: '',
  NUXT_GOOGLE_SERVICE_ACCOUNT: '',
  NUXT_GOOGLE_SERVICE_ACCOUNT_FILE: '',
  NUXT_SITE_URL: 'http://localhost:4710',
}
await writeFile(dotenv, Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 })
// 호출한 터미널의 운영 환경변수가 dotenv를 이기지 못하게 같은 값을 명시한다.
const env = { ...process.env, ...config }
delete env.MEMO_DESKTOP_TEST_PASSWORD
const child = spawn(process.execPath, [resolve(root, 'node_modules/nuxt/bin/nuxt.mjs'), 'dev', '--dotenv', dotenv, '--port', '4710', '--host', '127.0.0.1'], {
  cwd: root, env, stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', code => process.exit(code ?? 1))
