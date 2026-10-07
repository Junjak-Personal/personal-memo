import { describe, expect, it } from 'vitest'
import { parseMemo, serializeMemo } from './file'

const fields = { id: 'ID', title: '제목', created: null, updated: null, date: null, dateEnd: null }

describe('frontmatter', () => {
  it('frontmatter 가 없으면 전체가 본문이다', () => {
    const parsed = parseMemo('그냥 본문\n')
    expect(parsed).toMatchObject({ ok: true, doc: null, body: '그냥 본문\n' })
  })

  it('비어 있는 frontmatter 도 읽는다', () => {
    const parsed = parseMemo('---\n---\n\n본문\n')
    expect(parsed).toMatchObject({ ok: true, body: '본문\n' })
  })

  it('숫자로 읽힌 제목을 문자열로 되돌린다', () => {
    const parsed = parseMemo('---\ntitle: 123\n---\n본문')
    expect(parsed.ok && parsed.fields.title).toBe('123')
  })

  it('쓰고 다시 읽으면 같다 — 제목이 숫자·날짜처럼 보여도', () => {
    for (const title of ['123', '2026-10-10', 'true', 'null', '콜론: 있음', '#해시']) {
      const raw = serializeMemo(null, { ...fields, title }, '본문')
      const back = parseMemo(raw)
      expect(back.ok && back.fields.title).toBe(title)
      expect(back.ok && back.body).toBe('본문\n')
    }
  })

  it('date 를 지우면 키도 지운다', () => {
    const first = parseMemo(serializeMemo(null, { ...fields, date: '2026-10-10', dateEnd: '2026-10-12' }, ''))
    expect(first.ok && first.fields.dateEnd).toBe('2026-10-12')
    const raw = serializeMemo(first.ok ? first.doc : null, fields, '')
    expect(raw).not.toContain('date')
  })

  it('YAML 이 깨졌거나 맵이 아니면 읽지 못한 것으로 둔다', () => {
    expect(parseMemo('---\ntitle: [x\n---\n본문').ok).toBe(false)
    expect(parseMemo('---\n- 목록\n---\n본문').ok).toBe(false)
  })
})
