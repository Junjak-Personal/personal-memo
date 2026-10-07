/**
 * 로그인 비밀번호 해시 생성. 출력값을 .env.prd 의 NUXT_ADMIN_PASSWORD_HASH 에 넣는다.
 * 평문은 어디에도 저장하지 않는다.
 *
 *   node scripts/hash-password.mjs '<비밀번호>'      인자로 (셸 히스토리에 남는다)
 *   printf '%s' '<비밀번호>' | node scripts/hash-password.mjs   stdin 으로 (권장)
 *
 * nuxt-auth-utils 와 같은 scrypt 구현이라 서버가 그대로 검증한다.
 */
import { Hash } from '@adonisjs/hash'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'

async function readStdin() {
  if (process.stdin.isTTY) return ''
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  // 마지막 개행만 떼고 나머지는 그대로 둔다 — 비밀번호에 공백이 있을 수 있다
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

const password = process.argv[2] ?? (await readStdin())

if (!password) {
  console.error("usage: node scripts/hash-password.mjs '<password>'")
  console.error("   or: printf '%s' '<password>' | node scripts/hash-password.mjs")
  process.exit(1)
}

console.log(await new Hash(new Scrypt({})).make(password))
