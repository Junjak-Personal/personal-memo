<script setup lang="ts">
const documentPending = useState('memo-document-pending', () => false)
</script>

<template>
  <UDashboardGroup unit="rem" storage="local">
    <AppSidebar />
    <!-- 페이지 페이드는 본문에만 적용한다 — 헤더와 목록 버튼은 화면이 바뀌어도 그대로 둔다. -->
    <UDashboardPanel id="main" :ui="{ root: 'isolate min-h-0', body: 'p-0 sm:p-0 gap-0 sm:gap-0 pb-[env(safe-area-inset-bottom)] sm:pb-[env(safe-area-inset-bottom)]' }">
      <template #header>
        <div class="relative shrink-0 bg-default" data-testid="app-header">
          <progress v-if="documentPending" aria-label="메모를 불러오는 중" class="absolute inset-x-0 top-0 z-10 h-0.5 w-full accent-primary" data-testid="memo-navigation-progress" />
          <div :inert="documentPending">
          <UDashboardNavbar :ui="{ center: 'min-w-0 overflow-x-auto' }">
            <!-- 폰에서 목록을 여는 버튼 — PC 의 펼치기와 같은 » (≡ 대신, 2026-10-15 사용자 요청) -->
            <template #toggle>
              <UDashboardSidebarToggle icon="i-lucide-chevrons-right" class="size-11 justify-center" data-testid="app-sidebar-toggle" />
            </template>
            <template #leading>
              <UDashboardSidebarCollapse data-testid="app-sidebar-collapse" />
            </template>
            <template #title>
              <span id="app-header-title" />
            </template>
            <div id="app-header-toolbar" class="min-w-0" />
            <template #right>
              <div class="flex min-w-0 items-center gap-1.5">
                <div id="app-header-actions" class="flex min-w-0 items-center gap-1.5" />
                <MemoSyncStatus />
              </div>
            </template>
          </UDashboardNavbar>
          <div id="app-header-secondary" class="empty:hidden" />
          </div>
        </div>
      </template>
      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
