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
const createImageUpload = vi.fn((memoId: string) => ({ url: `http://memo.test/mcp/uploads/t-${memoId}`, expiresAt: Date.UTC(2026, 9, 16, 1, 10) }))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memo-mcp-'))
  await mkdir(join(root, 'memos'))
  store = new MemoStore(join(root, 'memos'))
  await store.init()
  const server = buildMcpServer({ store, notify, notifyRemoved, log, client: 'claude.ai', createImageUpload })
  const [a, b] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1' })
  await Promise.all([server.connect(a), client.connect(b)])
  notify.mockClear()
  notifyRemoved.mockClear()
  log.mockClear()
  createImageUpload.mockClear()
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
      [
        'calendar',
        'create_folder',
        'create_image_upload',
        'create_memo',
        'list_memos',
        'list_todos',
        'move_memo',
        'read_memo',
        'search_memos',
        'set_todo',
        'trash_memo',
        'update_memo',
      ].sort(),
    )
    expect(tools.find((t) => t.name === 'read_memo')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'trash_memo')?.annotations?.destructiveHint).toBe(true)
  })

  it('만들기 — 없는 폴더는 거절, 폴더를 만들고 나면 된다. 캘린더 알림·기록', async () => {
    const missing = await call('create_memo', { folder: '업무', title: '회의록', content: '## 안건\n' })
    expect(missing.isError).toBe(true)
    await call('create_folder', { name: '업무' })
    const created = await call('create_memo', { folder: '업무', title: '회의록', content: '## 안건\n', date: '2026-10-20', tags: ['업무'] })
    expect(created.data).toMatchObject({ title: '회의록', folder: '업무', date: '2026-10-20', tags: ['업무'], todo: null })
    expect(created.data).not.toHaveProperty('priority')
    const file = await readFile(join(root, 'memos/업무/회의록.md'), 'utf8')
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
    expect((await call('read_memo', { id: a.id })).data).toMatchObject({ todo: null, folder: '' })
  })

  it('할 일 순서는 날짜 빠른 순(날짜 없는 것은 맨 아래), 같은 날짜는 중요도순. 할 일은 「할 일」 폴더에 생긴다', async () => {
    await call('create_folder', { name: '업무' })
    const later = (await call('create_memo', { folder: '업무', title: '나중', date: '2026-11-02', todo: true })).data
    expect(later).toMatchObject({ folder: '할 일', priority: 'medium' })
    await call('create_memo', { title: '먼저-하', date: '2026-11-01', todo: true, priority: 'low' })
    await call('create_memo', { title: '먼저-상', date: '2026-11-01', todo: true, priority: 'high' })
    await call('create_memo', { title: '날짜 없음-상', todo: true, priority: 'high' })
    await call('create_memo', { title: '날짜 없음-하', todo: true, priority: 'low' })
    const titles = async () => (await call('list_todos', {})).data.open.map((t: { title: string }) => t.title)
    expect(await titles()).toEqual(['먼저-상', '먼저-하', '나중', '날짜 없음-상', '날짜 없음-하'])

    expect((await call('set_todo', { id: later.id, priority: 'high' })).data).toMatchObject({ todo: 'open', priority: 'high' })
    expect((await call('set_todo', { id: later.id })).isError).toBe(true)
    expect((await call('set_todo', { id: later.id, state: 'none', priority: 'high' })).isError).toBe(true)

    // 「할 일」 폴더 밖으로 옮기면 일반 메모, 다시 넣으면 할 일
    expect((await call('move_memo', { id: later.id, folder: '업무' })).data).toMatchObject({ todo: null, folder: '업무' })
    expect((await call('move_memo', { id: later.id, folder: '할 일' })).data).toMatchObject({ todo: 'open', priority: 'medium' })
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

  it('이미지 올리기 링크 — 있는 메모만, 올리는 명령과 한도를 같이 준다', async () => {
    const memo = (await call('create_memo', { title: '여행', content: '동선\n' })).data
    const link = await call('create_image_upload', { id: memo.id })
    expect(link.data).toMatchObject({
      url: `http://memo.test/mcp/uploads/t-${memo.id}`,
      expiresAt: '2026-10-16T01:10:00.000Z',
      command: `curl -sS -T <파일> 'http://memo.test/mcp/uploads/t-${memo.id}'`,
      maxPixels: 2048,
      maxBytes: 10 * 1024 * 1024,
    })
    expect(createImageUpload).toHaveBeenCalledWith(memo.id)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[mcp] create_image_upload'))

    const missing = await call('create_image_upload', { id: '01NOTEXIST0000000000000000' })
    expect(missing.isError).toBe(true)
    expect(createImageUpload).toHaveBeenCalledTimes(1)
  })

  it('링크를 만들 수 없는 곳에서는 이미지 도구를 두지 않는다', async () => {
    const server = buildMcpServer({ store })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const bare = new Client({ name: 'bare', version: '1' })
    await Promise.all([server.connect(a), bare.connect(b)])
    expect((await bare.listTools()).tools.map((t) => t.name)).not.toContain('create_image_upload')
    await bare.close()
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
