import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 화면 쪽 순수 함수가 Nuxt 와 같은 별칭으로 공용 코드를 가져온다
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    // 저장소 핵심(server/memo), 공용 유틸, 화면 쪽 순수 함수 — Nuxt 런타임 없이 돈다
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
  },
})
