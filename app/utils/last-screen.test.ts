import { describe, expect, it } from 'vitest'
import { availableScreen, needsScreenTree, readScreen, screenPath, screenScope, shouldRestoreScreen } from './last-screen'

describe('마지막 화면의 허용 범위와 손상 방어', () => {
  it.each([
    ['/', '/'], ['/todo', '/todo'], ['/todo/done', '/todo/done'], ['/tags', '/tags'],
    ['/tags?tag=%23Work&next=secret', '/tags?tag=Work'],
    ['/calendar?m=2026-10&d=2026-10-19&request=secret', '/calendar?m=2026-10&d=2026-10-19'],
    ['/m/01ABC?token=secret#heading', '/m/01ABC'],
    ['/m/p%3A%ED%9A%8C%EC%9D%98%2Fmemo.md', '/m/p%3A%ED%9A%8C%EC%9D%98%2Fmemo.md'],
  ])('허용 화면만 최소 상태로 저장: %s', (input, expected) => {
    expect(screenPath(input)).toBe(expected)
  })

  it.each(['/ai', '/login', '/oauth/consent?request=x', '/trash', '/settings', '/ext/id', '/todo/other',
    '//evil.test/m/a', 'https://evil.test', '/\\evil.test', '/m/', '/m/%zz', '/m/a/b', '/tags?tag=',
    '/calendar?m=2026-13', '/calendar?d=2026-02-30', `/tags?tag=${'a'.repeat(51)}`,
  ])('허용하지 않은/손상된 화면을 거절: %s', (input) => {
    expect(screenPath(input)).toBeNull()
  })

  it('스키마 버전·정규 주소·세션이 모두 같아야 읽는다', () => {
    const state = { version: 1, scope: 'one', path: '/tags?tag=work' }
    expect(readScreen(JSON.stringify(state), 'one')).toBe(state.path)
    expect(readScreen(JSON.stringify(state), 'two')).toBeNull()
    expect(readScreen(JSON.stringify({ ...state, version: 2 }), 'one')).toBeNull()
    expect(readScreen(JSON.stringify({ ...state, path: '/m/a?secret=x' }), 'one')).toBeNull()
    for (const raw of [null, '{}', '[1]', '{bad', 'null', '"/todo"']) expect(readScreen(raw, 'one')).toBeNull()
  })

  it('단일 소유자 인증의 세션 id와 로그인 시각으로 격리한다', () => {
    const session = { id: 'session-a', user: { owner: true }, loggedInAt: 123 }
    expect(screenScope(session)).toBe('owner:session-a:123')
    expect(screenScope({ ...session, id: 'session-b' })).not.toBe(screenScope(session))
    expect(screenScope({ ...session, loggedInAt: 124 })).not.toBe(screenScope(session))
    for (const bad of [null, {}, { ...session, id: '' }, { ...session, user: { id: 'another' } }, { ...session, loggedInAt: NaN }]) {
      expect(screenScope(bad)).toBeNull()
    }
  })

  it('삭제/휴지통/읽기 불가 메모와 사라진 태그는 복원하지 않는다', () => {
    const tree = { memos: [{ id: 'present', tags: ['Work'], unreadable: false }, { id: 'broken', tags: ['hidden'], unreadable: true }] }
    expect(availableScreen('/m/present', tree as Parameters<typeof availableScreen>[1])).toBe(true)
    expect(availableScreen('/m/deleted', tree as Parameters<typeof availableScreen>[1])).toBe(false)
    expect(availableScreen('/m/broken', tree as Parameters<typeof availableScreen>[1])).toBe(false)
    expect(availableScreen('/tags?tag=work', tree as Parameters<typeof availableScreen>[1])).toBe(true)
    expect(availableScreen('/tags?tag=missing', tree as Parameters<typeof availableScreen>[1])).toBe(false)
    expect(availableScreen('/tags?tag=hidden', tree as Parameters<typeof availableScreen>[1])).toBe(false)
    expect(needsScreenTree('/calendar')).toBe(false)
    expect(needsScreenTree('/tags?tag=work')).toBe(true)
  })

  it('최초의 정확한 기본 주소만 복원하고 명시적 링크·뒤로가기·재평가를 유지한다', () => {
    expect(shouldRestoreScreen('/', '/', false)).toBe(true)
    for (const initial of ['/todo', '/m/a', '/?next=x', '/#anchor', '/login', '/oauth/consent?request=x']) {
      expect(shouldRestoreScreen(initial, '/', false)).toBe(false)
    }
    expect(shouldRestoreScreen('/', '/todo', false)).toBe(false)
    expect(shouldRestoreScreen('/', '/', true)).toBe(false)
  })
})
