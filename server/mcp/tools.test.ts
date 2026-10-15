import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoStore } from '../memo/store'
import { buildMcpServer } from './tools'

let root: string
let store: MemoStore
let client: Client
const notify = vi.fn()
const notifyRemoved = vi.fn()
const log = vi.fn()

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memo-mcp-'))
  await mkdir(join(root, 'memos'))
  store = new MemoStore(join(root, 'memos'))
  await store.init()
  const server = buildMcpServer({ store, notify, notifyRemoved, log, client: 'claude.ai' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  notify.mockClear()
  notifyRemoved.mockClear()
  log.mockClear()
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

interface ToolText {
  isError?: boolean
  content: { type: string; text: string }[]
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolText
  const text = result.content[0]?.text ?? ''
  return { isError: result.isError === true, text, data: result.isError ? null : JSON.parse(text) }
}

describe('MCP 도구', () => {
  it('도구 목록 — 영구 삭제 도구는 없다', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['calendar', 'create_folder', 'create_memo', 'list_memos', 'list_todos', 'move_memo', 'read_memo', 'search_memos', 'set_todo', 'trash_memo', 'update_memo'].sort(),
    )
    expect(tools.find((t) => t.name === 'read_memo')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'trash_memo')?.annotations?.destructiveHint).toBe(true)
  })

  it('만들기 — 없는 폴더는 거절, 폴더를 만들고 나면 된다. 캘린더 알림·기록', async () => {
    const missing = await call('create_memo', { folder: '업무', title: '회의록', content: '## 안건\n' })
    expect(missing.isError).toBe(true)
    await call('create_folder', { name: '업무' })
    const created = await call('create_memo', { folder: '업무', title: '회의록', content: '## 안건\n', date: '2026-10-20', tags: ['업무'], todo: true })
    expect(created.data).toMatchObject({ title: '회의록', folder: '업무', date: '2026-10-20', tags: ['업무'], todo: 'open' })
    const file = await readFile(join(root, 'memos/업무/회의록.md'), 'utf8')
    expect(file).toContain('done: false')
    expect(file).toContain('## 안건')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[mcp] create_memo'))
  })

  it('잘못된 날짜는 거절된다', async () => {
    expect((await call('create_memo', { title: 'x', date: '2026-13-40' })).isError).toBe(true)
    expect((await call('create_memo', { title: 'x', date: '10월 20일' })).isError).toBe(true)
  })

  it('고치기 — 읽은 version 으로만. 준 필드만 바뀐다', async () => {
    const memo = (await call('create_memo', { title: '노트', content: '첫 줄\n', date: '2026-10-20', tags: ['a'] })).data
    const read = (await call('read_memo', { id: memo.id })).data
    expect(read).toMatchObject({ content: '첫 줄\n', version: expect.any(String) })

    const renamed = await call('update_memo', { id: memo.id, version: read.version, title: '새 노트' })
    expect(renamed.data).toMatchObject({ title: '새 노트', date: '2026-10-20', tags: ['a'] })
    expect((await call('read_memo', { id: memo.id })).data.content).toBe('첫 줄\n')

    // 그 사이 바뀌었다 — 옛 version 은 거절, 파일은 그대로
    const stale = await call('update_memo', { id: memo.id, version: read.version, content: '덮어쓰기\n' })
    expect(stale.isError).toBe(true)
    expect(stale.text).toContain('read_memo')
    expect((await call('read_memo', { id: memo.id })).data.content).toBe('첫 줄\n')

    const fresh = (await call('read_memo', { id: memo.id })).data
    const cleared = await call('update_memo', { id: memo.id, version: fresh.version, date: null })
    expect(cleared.data).toMatchObject({ date: null, dateEnd: null })
  })

  it('할 일·검색·캘린더', async () => {
    const a = (await call('create_memo', { title: '보고서', date: '2026-10-21', todo: true, tags: ['업무'] })).data
    await call('create_memo', { title: '장보기', todo: true })
    await call('set_todo', { id: a.id, state: 'done' })
    const todos = (await call('list_todos', { includeDone: true })).data
    expect(todos.open.map((t: { title: string }) => t.title)).toEqual(['장보기'])
    expect(todos.done.map((t: { title: string }) => t.title)).toEqual(['보고서'])
    expect((await call('search_memos', { query: '#업무' })).data.map((h: { title: string }) => h.title)).toEqual(['보고서'])
    // 끝낸 할 일은 일정에서 빠진다
    expect((await call('calendar', { from: '2026-10-01', to: '2026-10-31' })).data.scheduled).toEqual([])
    await call('set_todo', { id: a.id, state: 'none' })
    expect((await call('read_memo', { id: a.id })).data.todo).toBeNull()
  })

  it('옮기기·휴지통 — 휴지통은 되살릴 수 있는 이동이다', async () => {
    await call('create_folder', { name: '보관' })
    const memo = (await call('create_memo', { title: '옛 메모', content: '본문\n' })).data
    expect((await call('move_memo', { id: memo.id, folder: '보관' })).data).toMatchObject({ folder: '보관' })
    const trashed = await call('trash_memo', { id: memo.id })
    expect(trashed.data).toMatchObject({ trashed: true, trashPath: '보관/옛 메모.md' })
    expect(await readFile(join(root, 'memos/.trash/보관/옛 메모.md'), 'utf8')).toContain('본문')
    expect(notifyRemoved).toHaveBeenCalledWith(memo.id)
    expect((await call('list_memos')).data.memos).toEqual([])
  })

  it('목록 — 폴더로 거른다', async () => {
    await call('create_folder', { name: '업무' })
    await call('create_folder', { parent: '업무', name: '회의' })
    await call('create_memo', { folder: '업무/회의', title: 'A' })
    await call('create_memo', { title: 'B' })
    const work = (await call('list_memos', { folder: '업무' })).data
    expect(work.folders).toEqual(['업무', '업무/회의'])
    expect(work.memos.map((m: { title: string }) => m.title)).toEqual(['A'])
  })
})
