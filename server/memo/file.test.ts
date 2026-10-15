import { describe, expect, it } from 'vitest'
import { parseMemo, serializeMemo, versionOf } from './file'

const fields = { id: 'ID', title: '제목', created: null, updated: null, date: null, dateEnd: null, tags: [] as string[], done: null as boolean | null, public: false }

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

  it('태그는 한 줄 목록·블록 목록·쉼표 문자열 모두 읽는다', () => {
    const tagsOf = (yaml: string) => {
      const parsed = parseMemo(`---\n${yaml}\n---\n본문`)
      return parsed.ok ? parsed.fields.tags : null
    }
    expect(tagsOf('tags: [업무, "#회의"]')).toEqual(['업무', '회의'])
    expect(tagsOf('tags:\n  - 업무\n  - 2026')).toEqual(['업무', '2026'])
    expect(tagsOf('tags: 업무, 회의')).toEqual(['업무', '회의'])
    expect(tagsOf('title: 없음')).toEqual([])
  })

  it('새로 쓰는 태그는 한 줄 목록, 비우면 키를 지운다', () => {
    const raw = serializeMemo(null, { ...fields, tags: ['업무', '회의'] }, '본문')
    expect(raw).toContain('tags: [업무, 회의]')
    const parsed = parseMemo(raw)
    if (!parsed.ok) throw new Error('읽지 못함')
    expect(serializeMemo(parsed.doc, { ...fields, tags: [] }, '본문')).not.toContain('tags')
  })

  it('태그가 그대로면 밖에서 쓴 모양(블록 목록·주석)을 건드리지 않는다', () => {
    const original = '---\ntitle: 제목\ntags:\n  - 업무 # 회사 일\n  - 회의\n---\n\n본문\n'
    const parsed = parseMemo(original)
    if (!parsed.ok) throw new Error('읽지 못함')
    const raw = serializeMemo(parsed.doc, { ...fields, id: null, title: '제목', tags: ['업무', '회의'] }, '본문')
    expect(raw).toContain('tags:\n  - 업무 # 회사 일\n  - 회의\n')
  })

  it('YAML 이 깨졌거나 맵이 아니면 읽지 못한 것으로 둔다', () => {
    expect(parseMemo('---\ntitle: [x\n---\n본문').ok).toBe(false)
    expect(parseMemo('---\n- 목록\n---\n본문').ok).toBe(false)
  })

  it('할 일: done 은 true/false 만 읽고, 다른 값은 메모(null)로 본다', () => {
    const doneOf = (yaml: string) => {
      const parsed = parseMemo(`---\n${yaml}\n---\n본문`)
      return parsed.ok ? parsed.fields.done : 'unreadable'
    }
    expect(doneOf('title: a')).toBe(null)
    expect(doneOf('done: false')).toBe(false)
    expect(doneOf('done: true')).toBe(true)
    expect(doneOf('done: yes')).toBe(null)
    expect(doneOf('done: 1')).toBe(null)
    expect(doneOf('done:')).toBe(null)
  })

  it('할 일: 바뀌었을 때만 쓰고, null 이면 키를 지운다. 모르는 값(done: yes)은 그대로 둔다', () => {
    const parsed = parseMemo('---\ntitle: 제목\ndone: false\n---\n\n본문\n')
    if (!parsed.ok) throw new Error('읽지 못함')
    expect(serializeMemo(parsed.doc, { ...fields, id: null, done: true }, '본문')).toContain('done: true\n')
    const again = parseMemo('---\ntitle: 제목\ndone: false\n---\n\n본문\n')
    if (!again.ok) throw new Error('읽지 못함')
    expect(serializeMemo(again.doc, { ...fields, id: null, done: null }, '본문')).not.toContain('done')

    const odd = parseMemo('---\ntitle: 제목\ndone: yes\n---\n\n본문\n')
    if (!odd.ok) throw new Error('읽지 못함')
    expect(serializeMemo(odd.doc, { ...fields, id: null, done: odd.fields.done }, '본문')).toContain('done: yes\n')
  })

  it('버전은 done 줄을 뺀 내용으로 잰다 — 체크해도 열린 편집기의 저장이 충돌 나지 않게', () => {
    const base = '---\nid: X\ntitle: 제목\n---\n\n본문\n'
    const todo = '---\nid: X\ntitle: 제목\ndone: false\n---\n\n본문\n'
    const doneMid = '---\nid: X\ndone: true\ntitle: 제목\n---\n\n본문\n'
    expect(versionOf(todo)).toBe(versionOf(base))
    expect(versionOf(doneMid)).toBe(versionOf(base))
    // 본문의 done: 줄은 내용이다
    expect(versionOf(`${base}done: true\n`)).not.toBe(versionOf(base))
    // 다른 키가 바뀌면 버전도 바뀐다
    expect(versionOf(todo.replace('제목', '다른 제목'))).not.toBe(versionOf(todo))
  })

  it('외부 공개: public: true 만 공개다. 켜면 public: true, 끄면 키를 지운다. 모르는 값은 그대로', () => {
    const publicOf = (yaml: string) => {
      const parsed = parseMemo(`---\n${yaml}\n---\n본문`)
      return parsed.ok ? parsed.fields.public : 'unreadable'
    }
    expect(publicOf('title: a')).toBe(false)
    expect(publicOf('public: true')).toBe(true)
    expect(publicOf('public: yes')).toBe(false)
    expect(publicOf('public: "true"')).toBe(false)
    expect(publicOf('public: 1')).toBe(false)

    const on = parseMemo('---\ntitle: 제목\n---\n\n본문\n')
    if (!on.ok) throw new Error('읽지 못함')
    expect(serializeMemo(on.doc, { ...fields, id: null, public: true }, '본문')).toContain('public: true\n')
    const off = parseMemo('---\ntitle: 제목\npublic: true\n---\n\n본문\n')
    if (!off.ok) throw new Error('읽지 못함')
    expect(serializeMemo(off.doc, { ...fields, id: null, public: false }, '본문')).not.toContain('public')
    const odd = parseMemo('---\ntitle: 제목\npublic: yes\n---\n\n본문\n')
    if (!odd.ok) throw new Error('읽지 못함')
    expect(serializeMemo(odd.doc, { ...fields, id: null, public: odd.fields.public }, '본문')).toContain('public: yes\n')
  })

  it('버전은 public 줄도 뺀다 — done 과 같이 있어도 둘 다', () => {
    const base = '---\nid: X\ntitle: 제목\n---\n\n본문\n'
    expect(versionOf('---\nid: X\npublic: true\ntitle: 제목\n---\n\n본문\n')).toBe(versionOf(base))
    expect(versionOf('---\nid: X\ntitle: 제목\ndone: false\npublic: true\n---\n\n본문\n')).toBe(versionOf(base))
    expect(versionOf(`${base}public: true\n`)).not.toBe(versionOf(base))
  })
})
