<script setup lang="ts">
/**
 * AI 연결 승인 (설계: _docs/active/planning/2026-10-16-mcp-connector.md). /oauth/authorize 가 클라이언트·돌아갈 주소를 확인한
 * 요청만 여기로 온다. 허용하면 그 AI 가 모든 메모를 읽고 쓸 수 있다(영구 삭제는 못 함).
 * 🔴 직접 시작한 연결일 때만 허용하라고 분명히 적는다 — 남이 보낸 승인 링크를 허용하면 남의 AI 가 내 메모를 쓰게 된다.
 */
definePageMeta({ layout: false })

interface ConsentRequest {
  clientHost: string
  clientId: string
  redirectHost: string
  loopback: boolean
}

const route = useRoute()
const id = typeof route.query.request === 'string' ? route.query.request : ''

const { data: request, error } = await useAsyncData(`oauth-request-${id}`, () =>
  $fetch<ConsentRequest>(`/api/oauth/requests/${encodeURIComponent(id)}`),
)

const deciding = ref<'allow' | 'deny' | null>(null)
const failed = ref<string | null>(null)

async function decide(allow: boolean) {
  if (deciding.value) return
  deciding.value = allow ? 'allow' : 'deny'
  failed.value = null
  try {
    const { redirect } = await $fetch<{ redirect: string }>(`/api/oauth/requests/${encodeURIComponent(id)}`, { method: 'POST', body: { allow } })
    window.location.assign(redirect)
  } catch (e) {
    failed.value = apiMessage(e, '처리하지 못했습니다')
    deciding.value = null
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-default p-4">
    <UCard class="w-full max-w-md" data-testid="oauth-consent">
      <div class="flex flex-col gap-4">
        <div class="flex items-center gap-2">
          <img src="/memo-logo.png" alt="" aria-hidden="true" width="40" height="40" class="size-10 object-contain" />
          <h1 class="text-lg font-semibold">AI 연결</h1>
        </div>

        <p v-if="error || !request" class="text-sm text-error" data-testid="oauth-consent-error">
          {{ apiMessage(error, '승인 요청이 없거나 만료됐습니다. AI 앱에서 다시 연결하세요.') }}
        </p>

        <template v-else>
          <p>
            <strong class="text-highlighted">{{ request.clientHost }}</strong> 의 AI 가 이 메모 앱에 연결하려 합니다.
          </p>
          <ul class="list-disc space-y-1 ps-5 text-sm text-muted">
            <li>모든 메모와 폴더를 읽고 검색합니다</li>
            <li>메모를 만들고 고치고, 할 일을 체크하고, 휴지통으로 옮깁니다</li>
            <li>영구 삭제(휴지통 비우기·폴더 지우기)는 할 수 없습니다</li>
          </ul>
          <p class="text-sm">
            허용하면 <strong class="text-highlighted" data-testid="oauth-consent-redirect">{{ request.redirectHost }}</strong> (으)로 돌아갑니다.
          </p>
          <UAlert
            v-if="request.loopback"
            color="warning"
            variant="subtle"
            icon="i-material-symbols-warning-outline"
            title="이 컴퓨터의 프로그램으로 돌아갑니다"
            description="Claude Code 처럼 지금 직접 실행한 프로그램이 아니라면 거부하세요."
          />
          <UAlert
            color="neutral"
            variant="subtle"
            icon="i-material-symbols-shield-outline"
            description="이 연결을 직접 시작했을 때만 허용하세요. 남이 보낸 링크로 왔다면 거부하세요. 연결은 「AI 연결」 화면에서 언제든 끊을 수 있습니다."
          />
          <p v-if="failed" class="text-sm text-error">{{ failed }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" :loading="deciding === 'deny'" :disabled="!!deciding" data-testid="oauth-consent-deny" @click="decide(false)">
              거부
            </UButton>
            <UButton :loading="deciding === 'allow'" :disabled="!!deciding" data-testid="oauth-consent-allow" @click="decide(true)">허용</UButton>
          </div>
        </template>
      </div>
    </UCard>
  </div>
</template>
