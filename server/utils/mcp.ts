import { ImageUploads } from '../mcp/uploads'

let uploads: ImageUploads | null = null

/** MCP 이미지 올리기 링크 — 프로세스 하나에 하나. 링크를 내주는 /mcp 와 받는 /mcp/uploads/:token 이 같이 쓴다 */
export function useImageUploads() {
  uploads ??= new ImageUploads()
  return uploads
}
