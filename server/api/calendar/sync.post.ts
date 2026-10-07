/**
 * 지금 대조한다. 끝날 때까지 기다렸다가 상태를 돌려준다.
 * `allowMassDelete` — 대량 삭제로 미뤄 둔 삭제를 사람이 확인하고 진행할 때만 true.
 */
export default defineEventHandler(async (event) => {
  const sync = useCalendarSync()
  if (!sync) return calendarSyncStatus()
  const body = await readBody<{ allowMassDelete?: unknown } | null>(event)
  await sync.run({ allowMassDelete: body?.allowMassDelete === true })
  return sync.status()
})
