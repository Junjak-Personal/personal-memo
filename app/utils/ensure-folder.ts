/** 최상위 폴더가 없으면 만든다 — 이미 있으면(409) 그대로 둔다. 「받은 메모」·「할 일」처럼 앱이 정한 폴더에 넣기 전에 */
export async function ensureFolder(name: string) {
  try {
    await $fetch('/api/folders', { method: 'POST', body: { parent: '', name } })
  } catch (e) {
    if (apiStatus(e) !== 409) throw e
  }
}
