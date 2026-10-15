<script setup lang="ts">
/**
 * AI 연결 (설계: _docs/active/planning/2026-10-16-mcp-connector.md) — 연결 주소와 붙이는 법, 연결된 AI, 끊기.
 * 모두 끊으면 서명 키도 바뀌어 이미 나간 접근 토큰까지 바로 무효다 — 다시 쓰려면 AI 앱에서 다시 연결한다.
 */
interface Connection {
  id: string
  clientHost: string
  createdAt: string
  lastUsedAt: string
}

const toast = useToast()

const { data, error, refresh } = await useAsyncData('oauth-connections', () =>
  $fetch<{ mcpUrl: string; connections: Connection[] }>('/api/oauth/connections'),
)

const confirmOpen = ref(false)
const busy = ref<string | null>(null)

const claudeCodeCommand = computed(() => `claude mcp add --transport http memo ${data.value?.mcpUrl ?? ''}`)

/** `2026-10-16T…Z` → `10월 16일 14:03` */
function formatTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title: '복사했습니다' })
  } catch {
    toast.add({ color: 'error', title: '복사하지 못했습니다' })
  }
}

async function disconnect(id: string) {
  busy.value = id
  try {
    await $fetch(`/api/oauth/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: '연결을 끊었습니다' })
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '끊지 못했습니다') })
  } finally {
    busy.value = null
  }
}

async function disconnectAll() {
  busy.value = 'all'
  try {
    await $fetch('/api/oauth/connections', { method: 'DELETE' })
    await refresh()
    confirmOpen.value = false
    toast.add({ title: '모든 AI 연결을 끊었습니다' })
  } catch (e) {
    toast.add({ color: 'error', title: apiMessage(e, '끊지 못했습니다') })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="flex w-full min-w-0 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
    <Teleport to="#app-header-title" defer>AI 연결</Teleport>

    <div class="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <p v-if="error" class="py-20 text-center text-error">{{ apiMessage(error, 'AI 연결을 불러오지 못했습니다') }}</p>

      <template v-else-if="data">
        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold">연결 주소 (MCP)</h2>
          <div class="flex items-center gap-2">
            <code class="min-w-0 flex-1 truncate rounded-md border border-default bg-elevated px-3 py-2 text-sm" data-testid="ai-mcp-url">{{ data.mcpUrl }}</code>
            <UButton color="neutral" variant="outline" icon="i-material-symbols-content-copy-outline" data-testid="ai-mcp-url-copy" @click="copy(data.mcpUrl)">
              복사
            </UButton>
          </div>
          <ul class="list-disc space-y-1 ps-5 text-sm text-muted">
            <li>claude.ai (웹·폰·Desktop): 설정 → 커넥터 → 「커스텀 커넥터 추가」 → 위 주소 → 연결 → 이 앱의 승인 화면에서 허용</li>
            <li>
              Claude Code: <code class="text-xs">{{ claudeCodeCommand }}</code>
              <UButton size="xs" color="neutral" variant="ghost" icon="i-material-symbols-content-copy-outline" aria-label="명령 복사" @click="copy(claudeCodeCommand)" />
              그다음 <code class="text-xs">/mcp</code> 에서 로그인
            </li>
            <li>AI 는 메모를 읽고 쓰고 휴지통으로 옮길 수 있습니다. 영구 삭제는 못 합니다.</li>
          </ul>
        </section>

        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold">연결된 AI <span class="font-normal text-muted">{{ data.connections.length }}</span></h2>
            <UButton
              color="error"
              variant="outline"
              size="sm"
              icon="i-material-symbols-link-off"
              :disabled="!data.connections.length"
              data-testid="ai-disconnect-all"
              @click="confirmOpen = true"
            >
              모두 끊기
            </UButton>
          </div>
          <p v-if="!data.connections.length" class="py-8 text-center text-sm text-muted" data-testid="ai-empty">연결된 AI 가 없습니다</p>
          <ul v-else class="flex flex-col divide-y divide-default" data-testid="ai-connections">
            <li v-for="c in data.connections" :key="c.id" class="flex items-center gap-3 py-2.5">
              <UIcon name="i-material-symbols-smart-toy-outline" class="size-5 shrink-0 text-dimmed" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{{ c.clientHost }}</p>
                <p class="truncate text-xs text-muted">연결 {{ formatTime(c.createdAt) }} · 마지막 사용 {{ formatTime(c.lastUsedAt) }}</p>
              </div>
              <UButton color="neutral" variant="outline" size="sm" :loading="busy === c.id" data-testid="ai-disconnect" @click="disconnect(c.id)">끊기</UButton>
            </li>
          </ul>
        </section>
      </template>
    </div>

    <UModal v-model:open="confirmOpen" title="모든 AI 연결을 끊을까요?" description="연결된 AI 가 더는 메모를 읽고 쓰지 못합니다. 다시 쓰려면 AI 앱에서 다시 연결해야 합니다.">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="confirmOpen = false">취소</UButton>
          <UButton color="error" :loading="busy === 'all'" data-testid="ai-disconnect-all-confirm" @click="disconnectAll">모두 끊기</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
