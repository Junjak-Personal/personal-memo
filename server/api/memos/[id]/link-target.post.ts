export default defineMemoHandler(async (event, store) => {
  const previousId = memoIdParam(event)
  const target = previousId.startsWith('p:')
    ? await (await useMemoNavigationStore()).promoteTarget(previousId, () => store.ensureLinkTarget(previousId))
    : await store.ensureLinkTarget(previousId)
  if (previousId !== target.id) useCalendarSync()?.notify(target)
  return target
})
