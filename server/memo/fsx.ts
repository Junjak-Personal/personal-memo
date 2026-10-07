import { randomUUID } from 'node:crypto'
import { lstat, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/**
 * 원자적 쓰기 — 같은 폴더의 임시 파일에 쓰고 rename 한다 (설계문서 §3.3).
 * 쓰다가 죽어도 반쪽 파일이 남지 않는다. 임시 파일은 `.` 으로 시작해 스캔에서 빠진다.
 */
export async function writeAtomic(abs: string, data: string | Uint8Array) {
  const tmp = join(dirname(abs), `.${basename(abs)}.${randomUUID()}.tmp`)
  const fh = await open(tmp, 'wx')
  try {
    await fh.writeFile(data)
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await rename(tmp, abs)
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

export async function exists(abs: string) {
  try {
    await lstat(abs)
    return true
  } catch {
    return false
  }
}
