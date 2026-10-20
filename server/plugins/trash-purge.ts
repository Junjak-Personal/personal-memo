/**
 * 휴지통 자동 비우기 (설계문서 §3.4) — 서버 시작 뒤 한 번, 그 뒤 하루에 한 번.
 * 들어간 지 30일(TRASH_RETENTION_DAYS)이 지난 메모를 지운다. 백업(매일, 14일 보관)에 .trash 가 들어가므로
 * 지운 뒤에도 백업에서 2주 동안 되살릴 수 있다.
 */
const START_DELAY_MS = 10_000
const INTERVAL_MS = 24 * 60 * 60 * 1000

export default defineNitroPlugin((nitroApp) => {
  async function purge() {
    try {
      const { memos, images } = await (await useMemoStore()).purgeTrash()
      if (memos) console.info(`[trash-purge] 오래된 메모 ${memos}개, 쓰지 않는 이미지 ${images}개를 지웠습니다`)
    } catch (e) {
      console.error('[trash-purge] 실패', e)
    }
    // 별도 try로 두어 한 정리 실패가 다른 정리를 막지 않게 한다. 새 타이머는 만들지 않는다.
    try {
      const revisions = await (await useMemoStore()).purgeHistory()
      if (revisions) console.info(`[history-purge] 보관 기간이 지난 수정 이력 ${revisions}개를 지웠습니다`)
    } catch (e) {
      console.error('[history-purge] 실패', e)
    }
  }
  const first = setTimeout(() => void purge(), START_DELAY_MS)
  const timer = setInterval(() => void purge(), INTERVAL_MS)
  nitroApp.hooks.hook('close', () => {
    clearTimeout(first)
    clearInterval(timer)
  })
})
