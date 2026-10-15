/**
 * MCP 이미지 올리기 링크 (설계문서 §11.1).
 *
 * 이미지 바이트를 도구 인자(base64)로 받으면 AI 가 그 글자를 직접 써야 한다 — 1.9MB PNG 가 250만 자다. 그래서 도구는 1회용 링크만
 * 주고, 셸이 있는 클라이언트(Claude Code 등)가 `curl -T` 로 올린다. 바이트는 AI 를 거치지 않는다.
 * 링크는 메모 하나·10분·성공 한 번. 서버는 줄이지 않으므로(§4) 큰 이미지는 거절한다 — 줄이는 건 화면에서 올릴 때처럼 클라이언트 몫이다.
 * 메모리에만 둔다 — 서버가 다시 뜨면 링크를 새로 받으면 된다.
 */
import { randomBytes } from 'node:crypto'

export const UPLOAD_TTL_MS = 10 * 60 * 1000
/** 화면에서 올릴 때 브라우저가 줄이는 크기와 같다 (app/utils/image-resize.ts 의 DISPLAY_MAX) */
export const UPLOAD_MAX_PIXELS = 2048
const MAX_PENDING = 20

export interface PendingUpload {
  memoId: string
  /** 링크를 받은 OAuth 연결 — 연결을 끊으면 링크도 못 쓴다 */
  family: string
  /** 기록용 클라이언트 호스트 */
  client: string
  expiresAt: number
}

export class ImageUploads {
  private readonly pending = new Map<string, PendingUpload>()

  constructor(private readonly now: () => number = Date.now) {}

  create(input: Omit<PendingUpload, 'expiresAt'>) {
    this.sweep()
    // 링크만 쌓는 클라이언트가 있어도 메모리가 늘지 않게 — 가장 오래된 것부터 버린다
    const oldest = this.pending.keys().next()
    if (this.pending.size >= MAX_PENDING && !oldest.done) this.pending.delete(oldest.value)
    const token = randomBytes(24).toString('base64url')
    const expiresAt = this.now() + UPLOAD_TTL_MS
    this.pending.set(token, { ...input, expiresAt })
    return { token, expiresAt }
  }

  /** 쓸 수 있는 링크면 그 내용. 아직 쓰지 않는다 — 크기 때문에 거절되면 줄여서 같은 링크로 다시 올린다 */
  peek(token: string): PendingUpload | null {
    const upload = this.pending.get(token)
    if (!upload) return null
    if (upload.expiresAt <= this.now()) {
      this.pending.delete(token)
      return null
    }
    return upload
  }

  /** 확인을 다 마친 뒤 쓴다. 같은 링크로 동시에 두 번 와도 true 는 한 번뿐이다 */
  consume(token: string) {
    return this.pending.delete(token)
  }

  private sweep() {
    for (const [token, upload] of this.pending) if (upload.expiresAt <= this.now()) this.pending.delete(token)
  }
}
