<script setup lang="ts">
definePageMeta({ layout: false })

const { fetch: fetchSession } = useUserSession()

const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

async function submit() {
  if (!password.value || submitting.value) return
  submitting.value = true
  error.value = null
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { password: password.value } })
    await fetchSession()
    await navigateTo('/')
  } catch (e) {
    error.value = apiMessage(e, '로그인하지 못했습니다')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-default p-4">
    <UCard class="w-full max-w-sm">
      <form class="space-y-5" @submit.prevent="submit">
        <div class="flex items-center gap-2">
          <img src="/memo-logo.png" alt="" aria-hidden="true" width="40" height="40" class="size-10 object-contain" />
          <h1 class="text-lg font-semibold">memo</h1>
        </div>
        <UFormField label="비밀번호" :error="error ?? undefined">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            autofocus
            class="w-full"
            data-testid="login-password-input"
          />
        </UFormField>
        <UButton type="submit" block :loading="submitting" data-testid="login-submit-button">로그인</UButton>
      </form>
    </UCard>
  </div>
</template>
