<script setup lang="ts">
import TrashList from './_modules/TrashList.vue'
</script>

<template>
  <div class="flex min-w-0 flex-1">
    <!--
      화면 전환 애니메이션은 페이지 최상위 요소가 하나여야 걸린다.
      🔴 이 주석을 div 밖(위)에 두면 안 된다. 개발 모드에서 주석도 노드라 최상위가 둘이 되고,
         전환이 끝나지 않아 다음 화면이 빈 채로 멈춘다 (2026-10-07 실제로 겪음).
    -->
    <TrashList />
  </div>
</template>
