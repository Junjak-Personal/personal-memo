<script setup lang="ts">
import TodoList from './_modules/TodoList.vue'
</script>

<template>
  <div class="flex min-w-0 flex-1">
    <!--
      화면 전환 애니메이션은 페이지 최상위 요소가 하나여야 걸린다 — UDashboardPanel 은 그렇지 않아 감싼다.
      🔴 이 주석을 div 밖(위)에 두면 안 된다 (trash/index.vue 와 같은 이유).
    -->
    <TodoList />
  </div>
</template>
