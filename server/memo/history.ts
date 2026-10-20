/**
 * 편집 전 내용을 숨김 이력에 보관한다. MemoStore의 exclusive 안에서만 부른다.
 * 화면용 이미지를 함께 복사해 원래 폴더 이동/이미지 정리와 이력의 수명을 분리한다.
 */
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { MemoInput } from '../../shared/types/memo'
import type { MemoRevision, MemoRevisionSummary } from '../../shared/types/memo-history'
import { isRelativeSrc, normalizePath } from '../../shared/utils/asset-path'
import { isDateString } from '../../shared/utils/memo-date'
import { isUlid, ulid } from '../../shared/utils/ulid'
import { MemoError } from './errors'
import { writeAtomic } from './fsx'
import { imageRefs, rewriteImageRefs } from './image-refs'
import { extOf, MAX_IMAGE_BYTES, MAX_ORIGINAL_BYTES, sniffImage, stemOf } from './images'
import { insideRoot, joinRel } from './paths'

export const HISTORY_LIMIT = 50
export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
export const HISTORY_GROUP_MS = 5 * 60 * 1000
const MAX_REVISION_ASSET_BYTES = 64 * 1024 * 1024
const ASSET_FILE = /^[0-9A-HJKMNP-TV-Z]{26}(?:\.orig)?\.(?:png|jpg|gif|webp)$/
const STAGING_DIR = /^\.pending-[0-9A-HJKMNP-TV-Z]{26}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/

interface AssetCopy { src: string; file: string; original?: string }
interface RecordFile { version: 1; memo: string; revision: MemoRevision; assets: AssetCopy[] }

function memoKey(id: string) {
  return createHash('sha256').update(id).digest('hex')
}

function summary(revision: MemoRevision): MemoRevisionSummary {
  return { id: revision.id, savedAt: revision.savedAt, title: revision.title, contentLength: revision.contentLength }
}

function assetPath(folder: string, src: string): string | null {
  let path: string | null
  try {
    if (src.startsWith('/api/files/')) path = normalizePath(decodeURIComponent(src.slice('/api/files/'.length)))
    else if (isRelativeSrc(src)) path = normalizePath(joinRel(folder, decodeURI(src)))
    else return null
  } catch { return null }
  if (!path || path.split('/').some((segment) => segment.startsWith('.'))) return null
  return /(?:^|\/)assets\/[^/]+$/.test(path) && extOf(path) ? path : null
}

function fingerprint(input: MemoInput) {
  return JSON.stringify([input.title, input.content, input.date, input.dateEnd, input.tags ?? []])
}

function recordOf(raw: string, key: string, id: string): RecordFile {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new MemoError('unreadable', '수정 이력 파일을 읽을 수 없습니다') }
  if (!value || typeof value !== 'object') throw new MemoError('unreadable', '수정 이력이 손상됐습니다')
  const record = value as Partial<RecordFile>
  const r = record.revision
  if (record.version !== 1 || record.memo !== key || !r || r.id !== id || !isUlid(r.id)
    || typeof r.savedAt !== 'string' || !Number.isFinite(Date.parse(r.savedAt))
    || typeof r.title !== 'string' || r.title.length > 200 || typeof r.content !== 'string' || r.content.length > 2_000_000
    || r.contentLength !== r.content.length || !Array.isArray(r.tags) || r.tags.some((tag) => typeof tag !== 'string')
    || !(r.date === null || typeof r.date === 'string' && isDateString(r.date))
    || !(r.dateEnd === null || typeof r.dateEnd === 'string' && isDateString(r.dateEnd))
    || !Array.isArray(record.assets) || record.assets.length > 10_000
    || record.assets.some((a) => !a || typeof a !== 'object' || typeof a.src !== 'string' || !ASSET_FILE.test(a.file)
      || (a.original !== undefined && !ASSET_FILE.test(a.original)))) {
    throw new MemoError('unreadable', '수정 이력이 손상됐습니다')
  }
  return record as RecordFile
}

export class MemoHistory {
  constructor(private readonly root: string, private readonly now = () => Date.now()) {}

  private path(id: string, revision = '') {
    if (revision && !isUlid(revision)) throw new MemoError('bad_request', '수정 이력 ID가 잘못됐습니다')
    return insideRoot(this.root, joinRel(`.history/${memoKey(id)}`, revision))
  }

  private async entries(id: string): Promise<RecordFile[]> {
    const folder = await this.path(id)
    const entries = await readdir(folder, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const out: RecordFile[] = []
    for (const entry of entries) {
      if (!isUlid(entry.name)) continue
      if (entry.isSymbolicLink()) throw new MemoError('unreadable', '수정 이력의 심볼릭 링크는 읽을 수 없습니다')
      if (!entry.isDirectory()) continue
      out.push(await this.read(id, entry.name))
    }
    return out.sort((a, b) => b.revision.savedAt.localeCompare(a.revision.savedAt) || b.revision.id.localeCompare(a.revision.id))
  }

  private async read(id: string, revision: string): Promise<RecordFile> {
    const folder = await this.path(id, revision)
    const path = await insideRoot(this.root, join(folder, 'revision.json'))
    const info = await lstat(path).catch(() => null)
    if (!info) throw new MemoError('not_found', '수정 이력을 찾을 수 없습니다')
    if (!info.isFile() || info.isSymbolicLink() || info.size > 9_000_000) throw new MemoError('unreadable', '수정 이력을 읽을 수 없습니다')
    return recordOf(await readFile(path, 'utf8'), memoKey(id), revision)
  }

  async list(id: string): Promise<MemoRevisionSummary[]> {
    const records = await this.entries(id)
    await this.prune(id, records)
    return records.filter((r) => Date.parse(r.revision.savedAt) >= this.now() - HISTORY_RETENTION_MS)
      .slice(0, HISTORY_LIMIT).map((r) => summary(r.revision))
  }

  async get(id: string, revision: string): Promise<MemoRevision> {
    const record = await this.read(id, revision)
    if (Date.parse(record.revision.savedAt) < this.now() - HISTORY_RETENTION_MS) throw new MemoError('not_found', '보관 기간이 지난 수정 이력입니다')
    return record.revision
  }

  /** 영구 삭제가 끝나고 같은 ID의 활성/휴지통 메모가 없을 때만 호출한다. */
  async remove(id: string) {
    await rm(await this.path(id), { recursive: true, force: true })
  }

  /** 기존 하루 정리 훅에서 호출한다. 열지 않는 메모도 보관 기간 뒤 디스크에서 제거한다. */
  async purgeExpired(now = this.now()): Promise<number> {
    const historyRoot = await insideRoot(this.root, '.history')
    const buckets = await readdir(historyRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    let removed = 0
    for (const bucket of buckets) {
      if (!/^[a-f0-9]{64}$/.test(bucket.name) || !bucket.isDirectory() || bucket.isSymbolicLink()) continue
      const folder = await insideRoot(this.root, join('.history', bucket.name))
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        if (STAGING_DIR.test(entry.name)) {
          // 중단된 자체 staging만 기한 뒤 회수한다. 애매한 이름이나 링크에는 손대지 않는다.
          const staging = await insideRoot(this.root, join(folder, entry.name))
          const info = await lstat(staging)
          if (info.isDirectory() && !info.isSymbolicLink() && info.mtimeMs < now - HISTORY_RETENTION_MS) {
            await rm(staging, { recursive: true, force: true })
            removed++
          }
          continue
        }
        if (!isUlid(entry.name)) continue
        const revisionFolder = await insideRoot(this.root, join(folder, entry.name))
        const recordPath = await insideRoot(this.root, join(revisionFolder, 'revision.json'))
        const info = await lstat(recordPath).catch(() => null)
        if (!info?.isFile() || info.isSymbolicLink() || info.size > 9_000_000) continue
        let record: RecordFile
        try { record = recordOf(await readFile(recordPath, 'utf8'), bucket.name, entry.name) }
        catch (error) {
          if (error instanceof MemoError && error.code === 'unreadable') continue // 알 수 없는/손상된 파일을 삭제 대상으로 추측하지 않는다.
          throw error
        }
        if (Date.parse(record.revision.savedAt) < now - HISTORY_RETENTION_MS) {
          await rm(revisionFolder, { recursive: true, force: true })
          removed++
        }
      }
    }
    return removed
  }

  private async prune(id: string, records: RecordFile[]) {
    for (const [index, record] of records.entries()) {
      if (index >= HISTORY_LIMIT || Date.parse(record.revision.savedAt) < this.now() - HISTORY_RETENTION_MS) {
        await rm(await this.path(id, record.revision.id), { recursive: true, force: true })
      }
    }
  }

  async capture(id: string, input: MemoInput, folder: string, force = false) {
    const records = await this.entries(id)
    await this.prune(id, records)
    const newest = records.find((r) => Date.parse(r.revision.savedAt) >= this.now() - HISTORY_RETENTION_MS)
    if (newest && (fingerprint(newest.revision) === fingerprint(input)
      || !force && this.now() - Date.parse(newest.revision.savedAt) < HISTORY_GROUP_MS)) return
    const revision: MemoRevision = {
      title: input.title, content: input.content, date: input.date, dateEnd: input.dateEnd, tags: input.tags ?? [],
      id: ulid(this.now()), savedAt: new Date(this.now()).toISOString(), contentLength: input.content.length,
    }
    const target = await this.path(id, revision.id)
    const parent = await this.path(id)
    await mkdir(parent, { recursive: true })
    // 프로세스가 이미지 복사 도중 종료돼도 목록은 완성된 버전만 보게 한다.
    const staging = await insideRoot(this.root, join(parent, `.pending-${revision.id}-${randomUUID()}`))
    await mkdir(staging)
    try {
      const assets: AssetCopy[] = []
      let bytes = 0
      for (const src of new Set(imageRefs(input.content).map(ref => ref.src))) {
        const rel = assetPath(folder, src)
        if (!rel) continue
        const source = await insideRoot(this.root, rel)
        const info = await lstat(source).catch(() => null)
        if (!info) continue // 이미 깨져 있던 참조는 원문 그대로 보관한다.
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_IMAGE_BYTES) throw new MemoError('unreadable', '이력에 보관할 이미지를 읽을 수 없습니다')
        const data = await readFile(source)
        const ext = sniffImage(data)
        if (!ext) continue
        const file = `${ulid()}.${ext}`
        bytes += data.length
        if (bytes > MAX_REVISION_ASSET_BYTES) throw new MemoError('too_large', '수정 이력의 이미지 보관은 버전당 64MB까지입니다')
        await writeAtomic(join(staging, file), data)
        const copy: AssetCopy = { src, file }
        for (const entry of await readdir(dirname(source), { withFileTypes: true })) {
          if (!entry.isFile() || entry.isSymbolicLink() || !extOf(entry.name) || stemOf(entry.name) !== stemOf(rel.slice(rel.lastIndexOf('/') + 1)) || !entry.name.includes('.orig.')) continue
          const originalPath = await insideRoot(this.root, join(dirname(source), entry.name))
          const originalInfo = await lstat(originalPath)
          if (originalInfo.size > MAX_ORIGINAL_BYTES) throw new MemoError('too_large', '이력에 보관할 원본 이미지가 너무 큽니다')
          const original = await readFile(originalPath)
          const originalExt = sniffImage(original)
          if (!originalExt) continue
          bytes += original.length
          if (bytes > MAX_REVISION_ASSET_BYTES) throw new MemoError('too_large', '수정 이력의 이미지 보관은 버전당 64MB까지입니다')
          copy.original = `${file.slice(0, file.lastIndexOf('.'))}.orig.${originalExt}`
          await writeAtomic(join(staging, copy.original), original)
          break
        }
        assets.push(copy)
      }
      await writeAtomic(join(staging, 'revision.json'), JSON.stringify({ version: 1, memo: memoKey(id), revision, assets } satisfies RecordFile))
      await rename(staging, target)
      await this.prune(id, [{ version: 1, memo: memoKey(id), revision, assets }, ...records])
    } catch (error) {
      await rm(staging, { recursive: true, force: true })
      throw error
    }
  }

  /** 보관 이미지는 현재 폴더의 새 이름으로 복사한다. 기존 이미지와 이름이 같아도 덮지 않는다. */
  async restoreInput(id: string, revision: string, folder: string): Promise<MemoInput> {
    const record = await this.read(id, revision)
    await this.get(id, revision)
    const replacements = new Map<string, string>()
    const source = await this.path(id, revision)
    for (const asset of record.assets) {
      const assetFolder = await insideRoot(this.root, joinRel(folder, 'assets'))
      await mkdir(assetFolder, { recursive: true })
      const destinationStem = ulid()
      for (const file of [asset.file, ...(asset.original ? [asset.original] : [])]) {
        const abs = await insideRoot(this.root, join(source, file))
        const info = await lstat(abs)
        if (!info.isFile() || info.isSymbolicLink() || info.size > (file === asset.file ? MAX_IMAGE_BYTES : MAX_ORIGINAL_BYTES)) throw new MemoError('unreadable', '보관된 이미지를 읽을 수 없습니다')
        const data = await readFile(abs)
        const ext = sniffImage(data)
        if (!ext) throw new MemoError('unreadable', '보관된 이미지가 손상됐습니다')
        const name = `${destinationStem}${file === asset.file ? '' : '.orig'}.${ext}`
        await writeAtomic(await insideRoot(this.root, join(assetFolder, name)), data)
        if (file === asset.file) replacements.set(asset.src, `assets/${name}`)
      }
    }
    return {
      title: record.revision.title,
      content: rewriteImageRefs(record.revision.content, replacements),
      date: record.revision.date, dateEnd: record.revision.dateEnd, tags: record.revision.tags,
    }
  }
}
