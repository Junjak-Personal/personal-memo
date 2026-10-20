import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Memo } from '../../shared/types/memo'
import type { MemoTemplate, MemoTemplateSummary } from '../../shared/types/memo-templates'
import { MAX_TAG_LENGTH, MAX_TAGS } from '../../shared/utils/tags'
import { isUlid, ulid } from '../../shared/utils/ulid'
import { MemoError } from './errors'
import { writeAtomic } from './fsx'
import { insideRoot } from './paths'
import { captureTemplateAssets, materializeTemplateAssets, TEMPLATE_ASSET_FILE, type TemplateAsset } from './template-assets'

export const TEMPLATE_LIMIT = 100
export const TEMPLATE_STAGING_MAX_AGE = 24 * 60 * 60 * 1000
const DIR = '.templates'
const PENDING = /^\.pending-[0-9A-HJKMNP-TV-Z]{26}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
interface RecordFile { version: 1; template: MemoTemplate; assets: TemplateAsset[] }

function validName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /\p{Cc}/u.test(value)) throw new MemoError('bad_request', '템플릿 이름은 공백이 아닌 200자 이하의 문자열이어야 합니다')
  return value.trim()
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemoError('bad_request', '요청 본문이 객체가 아닙니다')
  return value as Record<string, unknown>
}
export function templateSaveInput(raw: unknown) {
  const value = object(raw)
  if (typeof value.memoId !== 'string' || !value.memoId || value.memoId.length > 1024 || typeof value.baseVersion !== 'string' || !/^[0-9a-f]{32}$/.test(value.baseVersion)) throw new MemoError('bad_request', '메모 ID와 현재 저장 버전이 필요합니다')
  return { memoId: value.memoId, name: validName(value.name), baseVersion: value.baseVersion }
}
export function templateNameInput(raw: unknown) { return validName(object(raw).name) }
export function templateFolderInput(raw: unknown) {
  const folder = object(raw).folder
  if (typeof folder !== 'string' || folder.length > 1000) throw new MemoError('bad_request', '폴더 경로가 필요합니다')
  return folder
}
function assertId(id: string) { if (!isUlid(id)) throw new MemoError('bad_request', '템플릿 ID가 올바르지 않습니다') }
function summary(template: MemoTemplate): MemoTemplateSummary {
  const { id, name, createdAt, updatedAt } = template
  return { id, name, createdAt, updatedAt }
}
function validRecord(raw: unknown, id: string): raw is RecordFile {
  if (!raw || typeof raw !== 'object') return false
  const record = raw as Partial<RecordFile>
  const t = record.template
  if (record.version !== 1 || !t || t.id !== id || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 200 || /\p{Cc}/u.test(t.name) || typeof t.title !== 'string' || t.title.length > 200 || typeof t.content !== 'string' || t.content.length > 2_000_000) return false
  if (![t.createdAt, t.updatedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) return false
  if (!Array.isArray(t.tags) || t.tags.length > MAX_TAGS || !t.tags.every(tag => typeof tag === 'string' && tag.length <= MAX_TAG_LENGTH && !/\p{Cc}/u.test(tag))) return false
  return Array.isArray(record.assets) && record.assets.length <= 10000 && record.assets.every(asset => asset && typeof asset.src === 'string' && asset.src.length <= 4096 && typeof asset.file === 'string' && TEMPLATE_ASSET_FILE.test(asset.file) && !asset.file.includes('.orig.') && (asset.original === undefined || typeof asset.original === 'string' && TEMPLATE_ASSET_FILE.test(asset.original) && asset.original.startsWith(`${asset.file.split('.')[0]}.orig.`)))
}

/** 일반 메모와 독립된 숨김 스냅샷. MemoStore가 모든 작업을 직렬화한다. */
export class MemoTemplates {
  constructor(private readonly root: string) {}
  private async directory(create = false) {
    const abs = await insideRoot(this.root, DIR)
    const info = await lstat(abs).catch(() => null)
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new MemoError('unreadable', '템플릿 저장 위치가 올바르지 않습니다')
    if (!info && create) await mkdir(abs)
    return abs
  }
  private async record(id: string): Promise<RecordFile> {
    assertId(id)
    await this.directory()
    const dir = await insideRoot(this.root, `${DIR}/${id}`)
    const info = await lstat(dir).catch(() => null)
    if (!info || info.isSymbolicLink() || !info.isDirectory()) throw new MemoError('not_found', '템플릿을 찾을 수 없습니다')
    const path = await insideRoot(this.root, `${DIR}/${id}/template.json`)
    const file = await lstat(path).catch(() => null)
    if (!file?.isFile() || file.isSymbolicLink() || file.size > 12_000_000) throw new MemoError('unreadable', '템플릿을 읽을 수 없습니다')
    let raw: unknown
    try { raw = JSON.parse(await readFile(path, 'utf8')) } catch { throw new MemoError('unreadable', '템플릿을 읽을 수 없습니다') }
    if (!validRecord(raw, id)) throw new MemoError('unreadable', '템플릿 저장 내용이 올바르지 않습니다')
    return raw
  }
  async list(): Promise<MemoTemplateSummary[]> {
    const directory = await this.directory()
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error })
    const out: MemoTemplateSummary[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !isUlid(entry.name)) continue
      try { out.push(summary((await this.record(entry.name)).template)) } catch (error) {
        if (!(error instanceof MemoError)) throw error
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'ko'))
  }
  async get(id: string): Promise<MemoTemplate> { return (await this.record(id)).template }
  async save(memo: Memo, name: string): Promise<MemoTemplateSummary> {
    name = validName(name)
    if ((await this.list()).length >= TEMPLATE_LIMIT) throw new MemoError('bad_request', `템플릿은 ${TEMPLATE_LIMIT}개까지 저장할 수 있습니다`)
    const parent = await this.directory(true)
    const id = ulid()
    const now = new Date().toISOString()
    const template: MemoTemplate = { id, name, createdAt: now, updatedAt: now, title: memo.title, content: memo.content, tags: [...memo.tags] }
    if (!validRecord({ version: 1, template, assets: [] }, id)) throw new MemoError('bad_request', '메모 제목·본문·태그가 템플릿 저장 한도를 넘습니다')
    const staging = join(parent, `.pending-${id}-${randomUUID()}`)
    await mkdir(staging)
    try {
      const assets = await captureTemplateAssets(this.root, memo.folder, memo.content, staging)
      await writeAtomic(join(staging, 'template.json'), JSON.stringify({ version: 1, template, assets } satisfies RecordFile))
      await rename(staging, join(parent, id))
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
    return summary(template)
  }
  async rename(id: string, name: string): Promise<MemoTemplateSummary> {
    name = validName(name)
    const record = await this.record(id)
    record.template.name = name
    record.template.updatedAt = new Date().toISOString()
    await writeAtomic(await insideRoot(this.root, `${DIR}/${id}/template.json`), JSON.stringify(record))
    return summary(record.template)
  }
  async remove(id: string): Promise<void> {
    await this.record(id)
    await rm(await insideRoot(this.root, `${DIR}/${id}`), { recursive: true })
  }
  async instantiate(id: string, folder: string) {
    const record = await this.record(id)
    const result = await materializeTemplateAssets(this.root, `${DIR}/${id}`, record.assets, record.template.content, folder)
    return { title: record.template.title, tags: [...record.template.tags], ...result }
  }
  /** 앱이 만든 정확한 이름의 중단 작업만 하루 뒤 정리한다. 완성한 템플릿은 만료되지 않는다. */
  async purgeStaging(now = Date.now()) {
    const directory = await this.directory()
    let removed = 0
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !PENDING.test(entry.name)) continue
      const path = await insideRoot(this.root, `${DIR}/${entry.name}`)
      const info = await lstat(path)
      if (info.isDirectory() && !info.isSymbolicLink() && now - info.mtimeMs > TEMPLATE_STAGING_MAX_AGE) { await rm(path, { recursive: true }); removed++ }
    }
    return removed
  }
}
