import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import type { FolderNode } from '../../shared/types/memo'
import { isUlid } from '../../shared/utils/ulid'
import { ASSETS_DIR, folderOf, insideRoot, joinRel } from './paths'

export const FOLDER_PUBLIC_FILE = '.public.json'
const MAX_METADATA_BYTES = 4096

export interface FolderPublication {
  path: string
  name: string
  id: string
  direct: boolean
  inherited: boolean
  public: boolean
  metadata: boolean
  metadataId: string | null
  scopeId: string | null
  scopePath: string | null
}

type Metadata = { state: 'missing' } | { state: 'invalid' } | { state: 'valid'; id: string; public: boolean }

/** 경로를 공개 응답에 싣지 않으면서, 읽기 요청으로 원문 파일을 고치지 않는 식별자다. */
export function opaquePublicId(kind: 'folder' | 'memo', scopeId: string, path: string) {
  return `${kind === 'folder' ? 'f' : 'm'}-${createHash('sha256').update(`${kind}:${scopeId}:${path}`).digest('hex')}`
}

function parseMetadata(raw: string): Metadata {
  let data: unknown
  try { data = JSON.parse(raw) } catch { return { state: 'invalid' } }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { state: 'invalid' }
  if (!('id' in data) || typeof data.id !== 'string' || !isUlid(data.id) || !('public' in data) || typeof data.public !== 'boolean') return { state: 'invalid' }
  return { state: 'valid', id: data.id, public: data.public }
}

/** 폴더와 함께 이동하는 숨김 메타. 심볼릭 링크·손상 파일은 공개 권한으로 인정하지 않는다. */
async function readMetadata(root: string, path: string): Promise<Metadata> {
  let file
  try {
    const abs = await insideRoot(root, joinRel(path, FOLDER_PUBLIC_FILE))
    file = await open(abs, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? { state: 'missing' } : { state: 'invalid' }
  }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > MAX_METADATA_BYTES) return { state: 'invalid' }
    const bytes = Buffer.alloc(MAX_METADATA_BYTES + 1)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    return bytesRead > MAX_METADATA_BYTES ? { state: 'invalid' } : parseMetadata(bytes.toString('utf8', 0, bytesRead))
  } catch {
    return { state: 'invalid' }
  } finally { await file.close() }
}

export class FolderPublicIndex {
  readonly folders = new Map<string, FolderPublication>()
  private duplicateIds = new Set<string>()

  constructor(private readonly root: string) {}

  async rescan() {
    this.folders.clear()
    this.duplicateIds.clear()
    await this.walk('', null)
    // 밖에서 메타를 복사해 같은 공개 ID가 겹치면 두 트리 모두 공개 권한으로 인정하지 않는다.
    const counts = new Map<string, number>()
    for (const folder of this.folders.values()) if (folder.metadataId) counts.set(folder.metadataId, (counts.get(folder.metadataId) ?? 0) + 1)
    this.duplicateIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id))
    if (this.duplicateIds.size) {
      this.folders.clear()
      await this.walk('', null)
    }
  }

  private async walk(path: string, parent: FolderPublication | null) {
    let entries
    try { entries = await readdir(await insideRoot(this.root, path), { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === ASSETS_DIR) continue
      const child = joinRel(path, entry.name)
      let metadata = await readMetadata(this.root, child)
      if (metadata.state === 'valid' && this.duplicateIds.has(metadata.id)) metadata = { state: 'invalid' }
      const direct = metadata.state === 'valid' && metadata.public
      // 권한 파일이 손상됐으면 이 하위 트리의 상속도 중단한다. 독립 공개된 손자 폴더는 다시 시작할 수 있다.
      const publicInherited = parent?.public === true && metadata.state !== 'invalid'
      const scopeId = direct && metadata.state === 'valid' ? metadata.id : publicInherited ? parent!.scopeId : null
      const scopePath = direct ? child : publicInherited ? parent!.scopePath : null
      const folder = {
        path: child,
        name: basename(child),
        id: metadata.state === 'valid' ? metadata.id : scopeId && scopePath ? opaquePublicId('folder', scopeId, child.slice(scopePath.length + 1)) : '',
        direct,
        inherited: publicInherited,
        public: direct || publicInherited,
        metadata: metadata.state !== 'missing',
        metadataId: metadata.state === 'valid' ? metadata.id : null,
        scopeId,
        scopePath,
      }
      this.folders.set(child, folder)
      await this.walk(child, folder)
    }
  }

  memoId(path: string, id: string) {
    const folder = this.folders.get(folderOf(path))
    if (!id.startsWith('p:') || !folder?.public || !folder.scopeId || !folder.scopePath) return id
    return opaquePublicId('memo', folder.scopeId, path.slice(folder.scopePath.length + 1))
  }

  fields(path: string): Partial<Pick<FolderNode, 'public' | 'publicDirect' | 'publicInherited' | 'publicId'>> {
    const folder = this.folders.get(path)
    if (!folder || (!folder.public && !folder.metadata)) return {}
    return { public: folder.public, publicDirect: folder.direct, publicInherited: folder.inherited, publicId: folder.id }
  }
}
