import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('safeNext — 로그인 뒤 돌아갈 곳', () => {
  it('앱 안 경로만', () => {
    expect(safeNext('/oauth/consent?request=abc')).toBe('/oauth/consent?request=abc')
    expect(safeNext(['/todo'])).toBe('/todo')
  })

  it('밖으로 나가는 주소·로그인 화면·빈 값은 처음 화면', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/login?next=/x', '', undefined, null, 3]) {
      expect(safeNext(bad)).toBe('/')
    }
  })
})
