/**
 * 에디터의 표·체크리스트 스타일은 nuxt-ui-templates/editor (MIT, 커밋 4101ecc) 의 app.config.ts 에서 그대로 가져왔다.
 * 색만 바꿨다 — 강조색 에메랄드(2026-10-13 사용자 참고 이미지). 바탕·글자·테두리는 푸른 기 없는 회색(neutral) —
 * slate 로 두니 다크 모드 배경까지 남색으로 보였다 (2026-10-07 사용자 지적).
 */
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'neutral'
    },
    /*
     * 목록 접기·펼치기는 겹 쉐브론 — 접기 «, 펼치기 ». PC 접기 버튼과 폰의 열기·닫기가 같은 모양 (2026-10-15 사용자 요청).
     * 홑 쉐브론(‹)은 「뒤로 가기」로 읽혀서 겹으로 둔다.
     */
    icons: {
      panelOpen: 'i-lucide-chevrons-right',
      panelClose: 'i-lucide-chevrons-left'
    },
    // 짙은 주 버튼은 밝은 글씨로, 선택·포커스·강조 글씨는 테마별 primary 밝기를 쓴다.
    button: {
      compoundVariants: [
        {
          color: 'primary',
          variant: 'solid',
          class: 'text-neutral-50 bg-primary-action hover:bg-primary-action-hover active:bg-primary-action-hover disabled:bg-primary-action aria-disabled:bg-primary-action'
        }
      ]
    },
    // 화면 본문의 스크롤 끝이 홈 인디케이터 아래로 깔리지 않게 (viewport-fit=cover)
    dashboardPanel: {
      slots: {
        body: 'pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
      }
    },
    avatar: {
      slots: {
        root: 'rounded-md',
        fallback: 'text-inherit font-bold'
      }
    },
    editor: {
      slots: {
        base: [
          // Tables
          // 넓은 표는 표 안에서만 민다 — 문서 패널·상단 툴바까지 가로로 움직이지 않게.
          '[&_.tableWrapper]:max-w-full [&_.tableWrapper]:overflow-x-auto [&_.tableWrapper]:overscroll-x-contain',
          '[&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:rounded-md',
          '[&_th]:py-3 [&_th]:px-4 [&_th]:font-semibold [&_th]:text-sm [&_th]:text-left [&_th]:bg-muted/50 [&_th]:border-t [&_th]:border-b [&_th]:border-e [&_th]:first:border-s [&_th]:border-muted',
          '[&_th_p]:my-0 [&_th_p]:leading-5',
          '[&_td]:py-3 [&_td]:px-4 [&_td]:text-sm [&_td]:text-left [&_td]:border-b [&_td]:border-e [&_td]:first:border-s [&_td]:border-muted',
          '[&_td_p]:my-0 [&_td_p]:leading-5 [&_td_code]:text-xs/5 [&_td_ul]:my-0 [&_td_ol]:my-0 [&_td_ul]:ps-4.5 [&_td_ol]:ps-4.5 [&_td_li]:leading-6 [&_td_li]:my-0.5',
          '[&_tr:first-child_th:first-child]:rounded-tl-md [&_tr:first-child_th:last-child]:rounded-tr-md [&_tr:last-child_td:first-child]:rounded-bl-md [&_tr:last-child_td:last-child]:rounded-br-md',
          '[&_.selectedCell]:bg-primary/10 [&_.selectedCell]:ring-2 [&_.selectedCell]:ring-primary [&_.selectedCell]:ring-inset',
          // Task lists
          '[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:ps-1',
          '[&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-center [&_ul[data-type=taskList]_li]:ps-0',
          '[&_ul[data-type=taskList]_li_label]:inline-flex [&_ul[data-type=taskList]_li_label]:pr-2.5',
          '[&_ul[data-type=taskList]_li_label_input]:appearance-none [&_ul[data-type=taskList]_li_label_input]:size-4 [&_ul[data-type=taskList]_li_label_input]:rounded-sm [&_ul[data-type=taskList]_li_label_input]:ring [&_ul[data-type=taskList]_li_label_input]:ring-inset [&_ul[data-type=taskList]_li_label_input]:ring-accented [&_ul[data-type=taskList]_li_label_input]:outline-primary/25 [&_ul[data-type=taskList]_li_label_input]:outline-offset-0 [&_ul[data-type=taskList]_li_label_input]:bg-center',
          '[&_ul[data-type=taskList]_li_label_input]:focus-visible:outline-3 [&_ul[data-type=taskList]_li_label_input]:focus-visible:ring-primary',
          '[&_ul[data-type=taskList]_li_label_input:checked]:bg-primary [&_ul[data-type=taskList]_li_label_input:checked]:ring-primary [&_ul[data-type=taskList]_li_label_input:checked]:bg-[url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDZMOSAxN2wtNS01Ii8+PC9zdmc+)] dark:[&_ul[data-type=taskList]_li_label_input:checked]:bg-[url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImJsYWNrIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIwIDZMOSAxN2wtNS01Ii8+PC9zdmc+)]',
          '[&_ul[data-type=taskList]_li[data-checked=true]>div>p]:line-through [&_ul[data-type=taskList]_li[data-checked=true]>div>p]:opacity-50'
        ]
      }
    }
  }
})
