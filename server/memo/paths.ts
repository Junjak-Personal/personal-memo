/**
 * 경로 규칙 (설계문서 §3.3). API 로 들어오는 경로는 전부 여기를 지난다.
 */
import { lstat, realpath } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { MemoError } from './errors'

/** 폴더 이름으로 못 쓰는 것 — 앱이 쓰는 자리다 */
export const RESERVED = new Set(['assets', '.trash'])
export const TRASH_DIR = '.trash'
export const ASSETS_DIR = 'assets'

const MAX_SEGMENT = 100
const MAX_TITLE_FILE = 120

/**
 * 폴더 경로 검사. `''` 는 최상위.
 * 세그먼트마다: 비어 있지 않음, `.` 으로 시작하지 않음(`..`·숨김 포함), 예약 이름 아님, 금지 문자 없음.
 */
export function assertFolder(folder: string) {
  if (folder === '') return
  for (const seg of folder.split('/')) assertName(seg)
}

/** 폴더 이름 한 칸 */
export function assertName(name: string) {
  if (!name || name.trim() !== name) throw new MemoError('bad_request', '폴더 이름이 비어 있거나 앞뒤에 공백이 있습니다')
  if (name.startsWith('.')) throw new MemoError('bad_request', '폴더 이름은 「.」 으로 시작할 수 없습니다')
  if (RESERVED.has(name)) throw new MemoError('bad_request', `「${name}」 은 앱이 쓰는 이름입니다`)
  if (/[\\/\0]/.test(name) || /\p{Cc}/u.test(name)) throw new MemoError('bad_request', '폴더 이름에 쓸 수 없는 문자가 있습니다')
  if (name.length > MAX_SEGMENT) throw new MemoError('bad_request', `폴더 이름은 ${MAX_SEGMENT}자까지입니다`)
}

/**
 * 루트 안의 절대경로. 루트 밖을 가리키면 거부한다.
 *
 * 🔴 문자열 검사만으로는 부족하다 — 루트 안의 심볼릭 링크가 밖을 가리킬 수 있다.
 *    가장 깊이 존재하는 조상까지 realpath 로 풀어서 다시 확인한다.
 */
export async function insideRoot(root: string, rel: string) {
  const base = resolve(root)
  const target = resolve(base, rel)
  if (target !== base && !target.startsWith(base + sep)) throw new MemoError('bad_request', '경로가 저장소 밖을 가리킵니다')

  const realBase = await realpath(base)
  let probe = target
  for (;;) {
    try {
      await lstat(probe)
      break
    } catch {
      const parent = dirname(probe)
      if (parent === probe) break
      probe = parent
    }
  }
  const realProbe = await realpath(probe)
  if (realProbe !== realBase && !realProbe.startsWith(realBase + sep)) {
    throw new MemoError('bad_request', '경로가 저장소 밖을 가리킵니다')
  }
  return target
}

/** 제목 → 파일 이름(확장자 제외). 금지 문자는 공백으로, 앞쪽 점은 뗀다 */
export function fileBaseFromTitle(title: string) {
  const cleaned = title
    .replace(/[\\/\0]/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_TITLE_FILE)
    .trim()
  return cleaned || '제목 없음'
}

/** 슬래시 구분 상대경로 (윈도우 구분자를 쓰지 않는다) */
export function toRel(root: string, abs: string) {
  return relative(root, abs).split(sep).join('/')
}

export function folderOf(relPath: string) {
  const i = relPath.lastIndexOf('/')
  return i === -1 ? '' : relPath.slice(0, i)
}

export function joinRel(folder: string, name: string) {
  return folder ? `${folder}/${name}` : name
}

/** `회의록.md` 가 있으면 `회의록 (2).md`, … — exists 는 상대경로를 받는다 */
export async function uniqueMdPath(folder: string, base: string, exists: (rel: string) => Promise<boolean>) {
  for (let n = 1; ; n++) {
    const rel = joinRel(folder, n === 1 ? `${base}.md` : `${base} (${n}).md`)
    if (!(await exists(rel))) return rel
  }
}
