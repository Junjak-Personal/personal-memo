import { lstat, mkdir, open, readFile, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isRelativeSrc, normalizePath } from '../../shared/utils/asset-path'
import { ulid } from '../../shared/utils/ulid'
import { imageRefs, rewriteImageRefs } from './image-refs'
import { MemoError } from './errors'
import { writeAtomic } from './fsx'
import { extOf, MAX_IMAGE_BYTES, MAX_ORIGINAL_BYTES, sniffImage, stemOf } from './images'
import { insideRoot, joinRel } from './paths'

export interface TemplateAsset { src: string; file: string; original?: string }
export const TEMPLATE_ASSET_FILE = /^[0-9A-HJKMNP-TV-Z]{26}(?:\.orig)?\.(?:png|jpg|gif|webp)$/
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024

export function templateAssetPath(folder: string, src: string): string | null {
  let path: string | null
  try {
    if (src.startsWith('/api/files/')) path = normalizePath(decodeURIComponent(src.slice('/api/files/'.length)))
    else if (isRelativeSrc(src)) path = normalizePath(joinRel(folder, decodeURI(src)))
    else return null
  } catch { throw new MemoError('bad_request', '이미지 경로 인코딩이 올바르지 않습니다') }
  if (path === null || path.split('/').some(part => part.startsWith('.') || /[\\\0]/.test(part))) throw new MemoError('bad_request', '이미지 경로가 올바르지 않습니다')
  return /(?:^|\/)assets\/[^/]+$/.test(path) && extOf(path) ? path : null
}

async function imageBytes(root: string, rel: string, max: number) {
  const abs = await insideRoot(root, rel)
  const info = await lstat(abs).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink()) throw new MemoError('unreadable', '템플릿 이미지 파일을 읽을 수 없습니다')
  if (info.size > max) throw new MemoError('too_large', '템플릿 이미지가 너무 큽니다')
  const data = await readFile(abs)
  if (data.length > max || !sniffImage(data)) throw new MemoError('unreadable', '템플릿 이미지 형식이 올바르지 않습니다')
  return data
}

export async function captureTemplateAssets(root: string, folder: string, content: string, staging: string): Promise<TemplateAsset[]> {
  const out: TemplateAsset[] = []
  let bytes = 0
  for (const src of new Set(imageRefs(content).map(ref => ref.src))) {
    if (src.length > 4096) throw new MemoError('bad_request', '이미지 경로가 너무 깁니다')
    const path = templateAssetPath(folder, src)
    if (!path) continue
    const data = await imageBytes(root, path, MAX_IMAGE_BYTES)
    const file = `${ulid()}.${sniffImage(data)}`
    const asset: TemplateAsset = { src, file }
    bytes += data.length
    if (bytes > MAX_SNAPSHOT_BYTES) throw new MemoError('too_large', '템플릿 이미지 합계가 64MiB를 넘습니다')
    await writeAtomic(join(staging, file), data)
    for (const name of await readdir(await insideRoot(root, dirname(path)))) {
      if (!name.startsWith(`${basename(stemOf(path))}.orig.`) || !extOf(name)) continue
      const original = await imageBytes(root, joinRel(dirname(path), name), MAX_ORIGINAL_BYTES)
      bytes += original.length
      if (bytes > MAX_SNAPSHOT_BYTES) throw new MemoError('too_large', '템플릿 이미지 합계가 64MiB를 넘습니다')
      asset.original = `${stemOf(file)}.orig.${sniffImage(original)}`
      await writeAtomic(join(staging, asset.original), original)
      break
    }
    out.push(asset)
  }
  return out
}

/** 실패 때 이번 작업이 만든 파일만 정리한다. 템플릿 자체와 원본 이미지는 건드리지 않는다. */
export async function materializeTemplateAssets(root: string, snapshotRel: string, assets: TemplateAsset[], content: string, folder: string) {
  const created: string[] = []
  const replacements = new Map<string, string>()
  const writeNew = async (path: string, bytes: Uint8Array) => {
    const file = await open(path, 'wx')
    created.push(path)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  }
  const cleanup = async () => { for (const path of created) await rm(path, { force: true }) }
  try {
    if (assets.length) await mkdir(await insideRoot(root, joinRel(folder, 'assets')), { recursive: true })
    for (const asset of assets) {
      const data = await imageBytes(root, joinRel(snapshotRel, asset.file), MAX_IMAGE_BYTES)
      const stem = ulid()
      const file = `${stem}.${sniffImage(data)}`
      const dest = await insideRoot(root, joinRel(folder, `assets/${file}`))
      await writeNew(dest, data)
      if (asset.original) {
        const original = await imageBytes(root, joinRel(snapshotRel, asset.original), MAX_ORIGINAL_BYTES)
        const origDest = await insideRoot(root, joinRel(folder, `assets/${stem}.orig.${sniffImage(original)}`))
        await writeNew(origDest, original)
      }
      replacements.set(asset.src, `assets/${file}`)
    }
    return { content: rewriteImageRefs(content, replacements), cleanup }
  } catch (error) { await cleanup(); throw error }
}
