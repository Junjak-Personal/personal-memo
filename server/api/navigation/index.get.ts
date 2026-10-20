export default defineMemoHandler(async () => (await useMemoNavigationStore()).get())
