/** 연결된 AI — 어느 앱이, 언제 연결해, 마지막으로 언제 썼는지 */
export default defineEventHandler(async (event) => {
  const { resource } = oauthUrls(event)
  return { mcpUrl: resource, connections: (await useOAuthGrants()).connections() }
})
