import { describe, expect, it } from 'vitest'
import { compareDoneTodos, compareOpenTodos, doneInFolder, isScheduled } from './todo'

describe('isScheduled — 캘린더에 일정으로 보이는가', () => {
  it('날짜가 있는 미완료 할 일만, 일반 메모는 날짜가 있어도 제외한다', () => {
    expect(isScheduled({ date: '2026-10-15', done: null })).toBe(false)
    expect(isScheduled({ date: '2026-10-15', done: false })).toBe(true)
    expect(isScheduled({ date: '2026-10-15', done: true })).toBe(false)
    expect(isScheduled({ date: null, done: false })).toBe(false)
    expect(isScheduled({ date: null, done: null })).toBe(false)
  })
})

describe('compareDoneTodos — 완료 목록 순서', () => {
  it('날짜(없으면 만든 날)가 최근인 것부터', () => {
    const list = [
      { title: '옛 일정', date: '2026-10-01', created: '2026-09-20T09:00:00+09:00' },
      { title: '날짜 없음-최근', date: null, created: '2026-10-15T09:00:00+09:00' },
      { title: '20일', date: '2026-10-20', created: '2026-10-02T09:00:00+09:00' },
      { title: '날짜 없음-옛날', date: null, created: '2026-09-01T09:00:00+09:00' },
    ]
    expect(list.sort(compareDoneTodos).map((t) => t.title)).toEqual(['20일', '날짜 없음-최근', '옛 일정', '날짜 없음-옛날'])
  })
})

describe('compareOpenTodos — 「할 일」 화면 순서', () => {
  it('1차 날짜 빠른 순(날짜 없는 것은 맨 아래), 2차 중요도 상 → 중 → 하, 그다음 만든 시각 최근순', () => {
    const t = (title: string, date: string | null, priority: 'high' | 'medium' | 'low', created = '2026-10-01T09:00:00+09:00') => ({ title, date, priority, created })
    const list = [
      t('없음-하', null, 'low'),
      t('22일-중', '2026-10-22', 'medium'),
      t('없음-상', null, 'high'),
      t('20일-하', '2026-10-20', 'low'),
      t('22일-상', '2026-10-22', 'high'),
      t('20일-중-새것', '2026-10-20', 'medium', '2026-10-05T09:00:00+09:00'),
      t('20일-중-옛것', '2026-10-20', 'medium'),
    ]
    expect(list.sort(compareOpenTodos).map((x) => x.title)).toEqual(['20일-중-새것', '20일-중-옛것', '20일-하', '22일-상', '22일-중', '없음-상', '없음-하'])
  })
})

describe('doneInFolder — 할 일과 「할 일」 폴더는 함께 간다', () => {
  it('「할 일」 폴더면 할 일(끝낸 것은 그대로), 하위 폴더·다른 폴더면 일반 메모', () => {
    expect(doneInFolder(null, '할 일')).toBe(false)
    expect(doneInFolder(true, '할 일')).toBe(true)
    expect(doneInFolder(false, '')).toBeNull()
    expect(doneInFolder(true, '할 일/보관')).toBeNull()
  })
})
