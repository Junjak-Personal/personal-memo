import { describe, expect, it } from 'vitest'
import { ImageUploads, UPLOAD_TTL_MS } from './uploads'

const input = { memoId: 'm1', family: 'f1', client: 'claude.ai' }

describe('이미지 올리기 링크', () => {
  it('보기는 몇 번이든, 쓰기는 한 번', () => {
    const uploads = new ImageUploads()
    const { token } = uploads.create(input)
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(uploads.peek(token)).toMatchObject(input)
    expect(uploads.peek(token)).not.toBeNull()
    expect(uploads.consume(token)).toBe(true)
    expect(uploads.consume(token)).toBe(false)
    expect(uploads.peek(token)).toBeNull()
    expect(uploads.peek('없는-링크')).toBeNull()
  })

  it('10분이 지나면 못 쓴다', () => {
    let now = 1_000
    const uploads = new ImageUploads(() => now)
    const { token, expiresAt } = uploads.create(input)
    expect(expiresAt).toBe(1_000 + UPLOAD_TTL_MS)
    now += UPLOAD_TTL_MS - 1
    expect(uploads.peek(token)).not.toBeNull()
    now += 1
    expect(uploads.peek(token)).toBeNull()
  })

  it('20개가 넘으면 가장 오래된 링크부터 버린다', () => {
    const uploads = new ImageUploads()
    const tokens = Array.from({ length: 21 }, (_, i) => uploads.create({ ...input, memoId: `m${i}` }).token)
    expect(uploads.peek(tokens[0]!)).toBeNull()
    expect(uploads.peek(tokens[1]!)).not.toBeNull()
    expect(uploads.peek(tokens[20]!)).toMatchObject({ memoId: 'm20' })
  })
})
