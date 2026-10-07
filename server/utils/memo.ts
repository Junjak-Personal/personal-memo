/**
 * 저장소 하나를 프로세스 전체가 같이 쓴다. 저장소 안에서 작업이 한 줄로 서므로 둘을 만들면 안 된다.
 */
import { join, resolve } from 'node:path'
import type { H3Event } from 'h3'
import { MemoError } from '../memo/errors'
import { MemoStore } from '../memo/store'

let store: MemoStore | null = null
let ready: Promise<void> | null = null

export async function useMemoStore() {
  if (!store) {
    const { dataDir } = useRuntimeConfig()
    store = new MemoStore(resolve(join(dataDir, 'memos')))
    ready = store.init()
  }
  await ready
  return store
}

/** 저장소 오류를 HTTP 오류로. 화면은 data.message 를 그대로 보여준다 (statusMessage 는 ASCII 만 실린다) */
export function defineMemoHandler<T>(handler: (event: H3Event, store: MemoStore) => Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event, await useMemoStore())
    } catch (error) {
      if (error instanceof MemoError) {
        throw createError({
          statusCode: error.status,
          statusMessage: error.code,
          message: error.message,
          data: { code: error.code, message: error.message, ...error.extra },
        })
      }
      throw error
    }
  })
}

/** 라우트의 `:id` — `p:업무/회의록.md` 처럼 슬래시가 인코딩돼 들어오므로 풀어서 쓴다 */
export function memoIdParam(event: H3Event) {
  const id = getRouterParam(event, 'id', { decode: true })
  if (!id) throw new MemoError('bad_request', 'id 가 없습니다')
  return id
}

export function queryString(event: H3Event, key: string) {
  const value = getQuery(event)[key]
  return typeof value === 'string' ? value : ''
}
