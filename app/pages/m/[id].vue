<script setup lang="ts">
import MemoDocument from './_modules/MemoDocument.vue'

definePageMeta({
  /*
   * 메모에서 메모로 가도 이 화면은 그대로 두고 안의 MemoDocument 만 바꿔 끼운다 (아래 Suspense).
   * 🔴 주소마다 화면을 새로 세우면(Nuxt 기본) 페이드가 걸려 폰에서 깜빡임이 심했다 — 새 메모를 받은 뒤
   *    이전 메모의 본문과 위 툴바 줄이 먼저 사라져 화면이 37px 올라가고, 제목만 흐려진 다음 빈 화면을 거쳐
   *    새 메모가 들어오며 다시 내려왔다 (2026-10-16 사용자 지적, 실측). 다른 화면 ↔ 메모는 그대로 페이드.
   */
  key: 'memo',
})

const route = useRoute()
const { tick } = useActiveMemo()

/**
 * 경로 id(`p:…`)로 연 메모는 첫 저장에서 새 id 를 받아 주소가 바뀐다. 그때 화면을 새로 세우면
 * 쓰던 커서가 날아가므로, 바뀐 id → 처음 id 를 기억해 같은 key 를 쓴다.
 */
const aliases = useState<Record<string, string>>('memo-id-aliases', () => ({}))

const id = computed(() => String(route.params.id))
/** tick — 폴더를 옮기거나 이름을 바꿔 열린 메모의 위치가 바뀌면 화면을 새로 세운다 (useActiveMemo) */
const key = computed(() => `${aliases.value[id.value] ?? id.value}#${tick.value}`)

function onRenamed(from: string, to: string) {
  aliases.value = { ...aliases.value, [to]: aliases.value[from] ?? from }
  void navigateTo(memoPath(to), { replace: true })
}
</script>

<template>
  <div class="flex min-w-0 flex-1">
    <!--
      화면 전환 애니메이션은 페이지 최상위 요소가 하나여야 걸린다.
      🔴 이 주석을 div 밖(위)에 두면 안 된다. 개발 모드에서 주석도 노드라 최상위가 둘이 되고,
         전환이 끝나지 않아 다음 화면이 빈 채로 멈춘다 (2026-10-07 실제로 겪음).
    -->
    <!--
      메모가 바뀌면 화면을 새로 세운다 — 편집 상태가 다른 메모로 새지 않게.
      Suspense 가 새 메모를 받는 동안 이전 메모를 그대로 두었다가 한 번에 바꾼다(빈 화면 없음).
      suspensible — 다른 화면에서 처음 들어올 때는 Nuxt 의 페이지 전환이 메모를 받을 때까지 기다린다(지금과 같음).
    -->
    <Suspense suspensible>
      <MemoDocument :key="key" :memo-id="id" @renamed="onRenamed" />
    </Suspense>
  </div>
</template>
