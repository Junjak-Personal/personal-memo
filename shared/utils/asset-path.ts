/**
 * 본문 속 이미지 경로 ↔ 화면 주소.
 *
 * 본문(.md)에는 메모 폴더 기준 상대경로(`assets/01JB….jpg`)만 들어간다 — 그래야 다른 도구에서도
 * 열린다. 에디터 주소는 `/m/{id}` 라 그 상대경로로는 이미지가 안 열리므로, 화면에 그릴 때만
 * `/api/files/<폴더>/assets/<파일>` 로 바꾼다 (설계문서 §4).
 *
 * 폴더는 `memos/` 기준 상대경로이고, 최상위는 빈 문자열이다.
 */

const FILES_PREFIX = '/api/files/'

/** 스킴(`https:`, `data:`)이 있거나 `/` 로 시작하면 상대경로가 아니다 */
export function isRelativeSrc(src: string) {
  return src !== '' && !src.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(src)
}

/** `a/./b/../c` → `a/c`. 루트 위로 올라가면 null */
export function normalizePath(path: string) {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (!out.length) return null
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

/** 본문 속 경로 → 화면에서 열 주소. 상대경로가 아니면 그대로 둔다 */
export function toDisplaySrc(folder: string, src: string) {
  if (!isRelativeSrc(src)) return src
  const path = normalizePath(folder ? `${folder}/${src}` : src)
  if (path === null) return src
  return FILES_PREFIX + path.split('/').map(encodeURIComponent).join('/')
}

/**
 * 화면 주소 → 본문에 쓸 경로. 복사·붙여넣기로 HTML 을 거쳐 돌아올 때 쓴다.
 *
 * 같은 폴더의 이미지만 상대경로로 되돌린다. 다른 폴더의 이미지는 화면 주소를 그대로 돌려준다 —
 * 그 경우는 붙여넣을 때 이 메모의 `assets/` 로 다시 올려야 한다 (설계문서 §4, 미결).
 */
export function toStoredSrc(folder: string, src: string) {
  if (!src.startsWith(FILES_PREFIX)) return src
  const path = src.slice(FILES_PREFIX.length).split('/').map(decodeURIComponent).join('/')
  const prefix = folder ? `${folder}/` : ''
  if (!path.startsWith(prefix)) return src
  return path.slice(prefix.length)
}
