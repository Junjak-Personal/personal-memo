<template>
  <UDashboardGroup unit="rem" storage="local">
    <AppSidebar />
    <!-- 페이지 페이드는 본문에만 적용한다 — 헤더와 목록 버튼은 화면이 바뀌어도 그대로 둔다. -->
    <UDashboardPanel id="main" :ui="{ root: 'min-h-0', body: 'p-0 sm:p-0 gap-0 sm:gap-0 pb-[env(safe-area-inset-bottom)] sm:pb-[env(safe-area-inset-bottom)]' }">
      <template #header>
        <div class="shrink-0 bg-default" data-testid="app-header">
          <UDashboardNavbar :ui="{ center: 'min-w-0 overflow-x-auto' }">
            <template #toggle>
              <UDashboardSidebarToggle class="size-11 justify-center" data-testid="app-sidebar-toggle" />
            </template>
            <template #leading>
              <UDashboardSidebarCollapse data-testid="app-sidebar-collapse" />
            </template>
            <template #title>
              <span id="app-header-title" />
            </template>
            <div id="app-header-toolbar" class="min-w-0" />
            <template #right>
              <div id="app-header-actions" class="flex min-w-0 items-center gap-1.5" />
            </template>
          </UDashboardNavbar>
          <div id="app-header-secondary" class="empty:hidden" />
        </div>
      </template>
      <template #body>
        <slot />
      </template>
    </UDashboardPanel>
  </UDashboardGroup>
</template>
