/**
 * ULID — 메모 id 와 이미지 파일명. 시간순으로 정렬되고 겹치지 않는다.
 * 의존성을 들이지 않으려고 직접 만든다. 같은 밀리초 안의 순서(monotonic)는 보장하지 않는다 — 필요 없다.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulid(now = Date.now()) {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  // 256 은 32 의 배수라 나머지 연산에 치우침이 없다
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let rand = ''
  for (const b of bytes) rand += ALPHABET[b % 32]
  return time + rand
}

export function isUlid(value: string) {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
}
