import { lstat, readFile } from 'node:fs/promises'
import type { MemoMeta } from '../../shared/types/memo'
import { MAX_FAVORITE_MEMOS, MAX_RECENT_MEMOS, type MemoNavigationState } from '../../shared/types/memo-navigation'
import { MemoError } from './errors'
import { writeAtomic } from './fsx'
import { insideRoot } from './paths'

export const NAVIGATION_FILE = '.navigation.json'
const MAX_FILE_BYTES = 1_000_000

export function navigationId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new MemoError('bad_request', '메모 ID가 올바르지 않습니다')
  }
  return value
}

export function parseNavigationInput(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MemoError('bad_request', '요청 본문이 객체가 아닙니다')
  const value = raw as Record<string, unknown>
  return { value, id: navigationId(value.id) }
}

/** 단일 owner의 탐색 환경설정. 메모의 원문·정렬·수정 시각과 독립적으로 저장한다. */
export class MemoNavigationStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly root: string, private readonly memos: () => Promise<readonly MemoMeta[]>) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn, fn)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async file() {
    const path = await insideRoot(this.root, NAVIGATION_FILE)
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (info && (!info.isFile() || info.isSymbolicLink())) throw new MemoError('unreadable', '탐색 목록의 저장 경로를 사용할 수 없습니다')
    if (info && info.size > MAX_FILE_BYTES) throw new MemoError('unreadable', '탐색 목록 파일이 너무 큽니다')
    return { path, exists: info !== null }
  }

  private async read(): Promise<MemoNavigationState> {
    const file = await this.file()
    if (!file.exists) return { recent: [], favorites: [] }
    try {
      const raw: unknown = JSON.parse(await readFile(file.path, 'utf8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('shape')
      const state = raw as Record<string, unknown>
      if (state.version !== 1) throw new Error('version')
      const ids = (value: unknown, max: number) => {
        if (!Array.isArray(value) || value.length > max) throw new Error('list')
        return [...new Set(value.map(navigationId))]
      }
      return { recent: ids(state.recent, MAX_RECENT_MEMOS), favorites: ids(state.favorites, MAX_FAVORITE_MEMOS) }
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof MemoError || (error instanceof Error && ['shape', 'version', 'list'].includes(error.message))) {
        throw new MemoError('unreadable', '탐색 목록을 읽을 수 없습니다. 저장 파일을 확인해 주세요')
      }
      throw error
    }
  }

  private filter(state: MemoNavigationState, memos: readonly MemoMeta[]): MemoNavigationState {
    const available = new Set(memos.filter((memo) => !memo.unreadable).map((memo) => memo.id))
    return { recent: state.recent.filter((id) => available.has(id)), favorites: state.favorites.filter((id) => available.has(id)) }
  }

  private async write(state: MemoNavigationState) {
    const { path } = await this.file()
    await writeAtomic(path, JSON.stringify({ version: 1, ...state }))
    return state
  }

  get(): Promise<MemoNavigationState> {
    return this.exclusive(async () => this.filter(await this.read(), await this.memos()))
  }

  opened(id: string, previousId?: string): Promise<MemoNavigationState> {
    navigationId(id)
    if (previousId !== undefined) navigationId(previousId)
    return this.exclusive(async () => {
      const state = await this.read()
      const memos = await this.memos()
      this.requireMemo(id, memos)
      // 외부 파일의 첫 저장에서 p: 경로 ID가 ULID로 바뀐다. 사라진 이전 ID의 별표도 같이 옮긴다.
      if (previousId?.startsWith('p:') && previousId !== id && !memos.some((memo) => memo.id === previousId)) {
        state.favorites = [...new Set(state.favorites.map((key) => key === previousId ? id : key))]
        state.recent = state.recent.map((key) => key === previousId ? id : key)
      }
      const next = this.filter(state, memos)
      next.recent = [id, ...next.recent.filter((key) => key !== id)].slice(0, MAX_RECENT_MEMOS)
      return this.write(next)
    })
  }

  favorite(id: string, favorite: boolean): Promise<MemoNavigationState> {
    navigationId(id)
    if (typeof favorite !== 'boolean') throw new MemoError('bad_request', 'favorite: true 또는 false여야 합니다')
    return this.exclusive(async () => {
      const memos = await this.memos()
      this.requireMemo(id, memos)
      const next = this.filter(await this.read(), memos)
      if (favorite && !next.favorites.includes(id)) {
        if (next.favorites.length >= MAX_FAVORITE_MEMOS) throw new MemoError('too_large', `즐겨찾기는 ${MAX_FAVORITE_MEMOS}개까지입니다`)
        next.favorites.push(id)
      } else if (!favorite) next.favorites = next.favorites.filter((key) => key !== id)
      return this.write(next)
    })
  }

  /**
   * 기존 ID 목록을 읽은 뒤 target을 승격한다. nav→store 잠금 순서를 유지해 승격 직후의 다른 방문 기록이
   * 아직 이전하지 않은 p: 별표를 정리하는 틈을 없앤다. 방문은 새로 추가하지 않는다.
   */
  promoteTarget(previousId: string, promote: () => Promise<MemoMeta>): Promise<MemoMeta> {
    navigationId(previousId)
    return this.exclusive(async () => {
      const state = await this.read()
      const target = await promote()
      const memos = await this.memos()
      this.requireMemo(target.id, memos)
      if (!previousId.startsWith('p:') || previousId === target.id || memos.some(memo => memo.id === previousId)) return target
      const next = {
        recent: [...new Set(state.recent.map(key => key === previousId ? target.id : key))],
        favorites: [...new Set(state.favorites.map(key => key === previousId ? target.id : key))],
      }
      await this.write(this.filter(next, memos))
      return target
    })
  }

  private requireMemo(id: string, memos: readonly MemoMeta[]) {
    if (!memos.some((memo) => memo.id === id && !memo.unreadable)) throw new MemoError('not_found', '열 수 있는 메모가 아닙니다')
  }
}
