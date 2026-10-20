import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoStore } from '../../server/memo/store'

const root = dirname(fileURLToPath(import.meta.url))
const repo = resolve(root, '../..')
const uiRequire = createRequire(import.meta.resolve('@nuxt/ui'))
const browserModule = (name: string) => uiRequire.resolve(name).replace(/\.cjs$/, '.js')
interface TestServer {
  httpServer: Server | null
  middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void }
}

export default {
  root,
  resolve: {
    alias: {
      '@tiptap/starter-kit': browserModule('@tiptap/starter-kit'),
      '@tiptap/markdown': browserModule('@tiptap/markdown'),
      '~': resolve(repo, 'app'),
      '#shared': resolve(repo, 'shared'),
    },
  },
  server: { host: '127.0.0.1', port: 4731, strictPort: true, fs: { allow: [repo] } },
  plugins: [{
    name: 'isolated-memo-table-regression',
    async configureServer(server: TestServer) {
      // 실제 data/·.env·캘린더를 읽지 않는다. 서버를 끄면 합성 메모만 담긴 임시 폴더를 정리한다.
      const directory = await mkdtemp(join(tmpdir(), 'memo-table-browser-'))
      const memos = join(directory, 'memos')
      await mkdir(memos)
      const store = new MemoStore(memos)
      await store.init()
      const ids = new Set<string>()
      server.httpServer?.once('close', () => { void rm(directory, { recursive: true, force: true }) })
      server.middlewares.use('/__memo-table-test', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (req.method !== 'POST' || req.headers.host !== '127.0.0.1:4731' || req.headers.origin !== 'http://127.0.0.1:4731') {
          res.statusCode = 403
          res.end('{"error":"로컬 회귀 검사 전용입니다"}')
          return
        }
        try {
          let raw = ''
          for await (const chunk of req) {
            raw += chunk.toString()
            if (raw.length > 65536) throw new Error('검사 입력이 너무 큽니다')
          }
          const body: unknown = JSON.parse(raw)
          if (!body || typeof body !== 'object') throw new Error('잘못된 입력')
          const input = body as Record<string, unknown>
          if (input.action === 'create' && typeof input.content === 'string') {
            const memo = await store.create({ title: `합성 표 회귀 ${ids.size + 1}`, content: input.content, date: null, dateEnd: null, tags: [], folder: '' })
            ids.add(memo.id)
            res.end(JSON.stringify(memo))
          } else if (typeof input.id === 'string' && ids.has(input.id) && input.action === 'get') {
            res.end(JSON.stringify(await store.get(input.id)))
          } else if (typeof input.id === 'string' && ids.has(input.id) && input.action === 'update' && typeof input.content === 'string' && typeof input.baseVersion === 'string') {
            const previous = await store.get(input.id)
            res.end(JSON.stringify(await store.update(input.id, { title: previous.title, content: input.content, date: null, dateEnd: null, tags: [], baseVersion: input.baseVersion })))
          } else {
            throw new Error('이번 검사에서 만든 메모만 사용할 수 있습니다')
          }
        } catch (error) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : '검사 실패' }))
        }
      })
    },
  }],
}
