<script setup lang="ts">
const { creating, createMemo } = useCreateMemo()
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col p-4 sm:p-6">
    <!--
      화면 전환 애니메이션은 페이지 최상위 요소가 하나여야 걸린다.
      🔴 이 주석을 div 밖(위)에 두면 안 된다. 개발 모드에서 주석도 노드라 최상위가 둘이 되고,
         전환이 끝나지 않아 다음 화면이 빈 채로 멈춘다 (2026-10-07 실제로 겪음).
    -->
    <div class="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <img src="/memo-logo.png" alt="" aria-hidden="true" width="80" height="80" class="size-20 object-contain" />
      <p class="text-muted">
        <span class="hidden lg:inline">왼쪽 목록에서 메모를 고르거나 새로 만드세요</span>
        <span class="lg:hidden">≡ 를 눌러 목록을 열거나 새로 만드세요</span>
      </p>
      <UButton icon="i-material-symbols-add" :loading="creating" data-testid="home-new-button" @click="createMemo()">
        새 메모
      </UButton>
    </div>
  </div>
</template>
