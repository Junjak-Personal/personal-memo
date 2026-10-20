# UI Components

## Component Library
- Name: Nuxt UI 4 (+ reka-ui). 레이아웃은 nuxt-ui-templates/dashboard·editor 구조 (UDashboardGroup / UDashboardSidebar / UDashboardPanel / UDashboardNavbar)
- Import pattern: 자동 import (`U*`). `_modules/` 안의 자체 컴포넌트는 명시 import
- 에디터: `UEditor` + `UEditorToolbar`(상단·말풍선·이미지·표) + 슬래시 메뉴·끌기 손잡이 — `app/pages/m/_modules/editor/items.ts`
- 🔴 페이지 최상위는 감싸개 div 하나 — UDashboardPanel 은 단일 루트가 아니라 화면 전환이 멈춘다. 주석도 div 안에 둔다

## Icons
- Library: material-symbols 우선 (`i-material-symbols-*`), 그다음 lucide
- Usage: `icon="i-material-symbols-add"` / `<UIcon name="..." />`
- 🔴 `nuxt.config` 의 icon: `provider: 'server'`, `fallbackToApi: false`, clientBundle 스캔에 `.ts` 포함 — 외부 iconify API 를 쓰지 않는다

## Design Tokens
- Colors: `app/app.config.ts` — primary `emerald`(2026-10-13 사용자 참고 이미지), neutral `neutral`. 기본은 흰색·검정·회색
  `main.css` — `--ui-primary` 라이트 700 / 다크 400, 주 버튼은 라이트 700 / 다크 800 + 밝은 글씨, 다크 바탕 `neutral-950`
- Typography: Pretendard Variable (CDN, `nuxt.config` head) — `ui.fonts: false`
- 다크: 시스템 설정을 따른다
- 확대·축소 금지 (viewport + `plugins/no-pinch-zoom.client.ts`), `touch-action: manipulation`
- 안전 여백: `env(safe-area-inset-*)` (dashboardPanel body·사이드바 footer)

## Common Patterns
- 병합 표 테두리(2026-10-20): `table-layout.ts`의 ProseMirror TableMap decoration으로 실제 위/왼쪽 외곽과 네 모서리를 표시한다. DOM first/last-child는 rowspan 아래 내부 셀을 오판하므로 쓰지 않는다. 기본 아래/오른쪽 선에 외곽 위/왼쪽 선만 추가한다. 표시 class는 저장 내용에 포함되지 않는다. 일반/HTML 표에 동일 적용.
- 표 저장 유형(2026-10-20): `memoTableKit()`은 같은 table schema의 `memoTableFormat`으로 markdown/html을 구분한다. GFM 출력은 기존 그대로, HTML은 `data-memo-table="html"`과 span을 저장해 병합 해제 후에도 HTML 유지. 공통 확장이어서 편집/외부 보기 동일. 사람용 표 UI·병합 버튼은 변경 없음. 1~1000 정수 span, 스키마 serializer·선택적 형식 비교 유지. `editor-table.ts`, `canonical-table-html.ts`.
- 버튼: 배경이나 테두리가 반드시 있다. 헤더·툴바 = 아이콘 ghost, 섹션 = outline, 모달 하단 = 취소(outline) > 확인(default), 위험 = error
- 모달: `UModal` + `#body` + `#footer`(오른쪽 정렬)
- 실패·경고 안내: `UAlert` (subtle) + actions, 짧은 결과는 `useToast()`
- 저장 상태 같은 바뀌는 글자는 폭 고정 (툴바 밀림 방지 — `MemoSaveStatus.vue`)
- 폰 목록: 사이드바 slideover 전체 화면 (`mode="slideover"`)
- 하단 탐색: 할 일·캘린더·태그 아이콘과 ⋯ 메뉴(휴지통·AI 연결·로그아웃). 할 일 수·오늘 일정은 빨간 뱃지. 태그 목록은 `/tags` 전용 화면. (원격 2026-10-18 변경 유지)
- PC 끌어 놓기, 폰은 메뉴(다른 폴더로 옮기기)
- 본문 블록 이동(2026-10-20 후속): 상단 이동/완료 체크는 기존 메모 메뉴와 같은 UButton neutral/ghost·20px. 본문 왼쪽 +·손잡이는 ghost sm(16px), glyph를 서로 8px씩 당김, 각 44px 터치 영역과 모드 한정 padding-left 72px. +는 편집 복원 후 PC와 같은 suggestion handler로 해당 블록 아래 추가. 별도 버튼 CSS/시각 컨테이너/텍스트/안내/이동 모달 없음. 드래그·방향키·undo/redo, 본문 비편집·스크롤, 종료 시 편집/padding 복원. 목록·표 전체 이동, 평소 long press 선택 유지. 손잡이는 relative EditorContent 래퍼에 Teleport·absolute 콘텐츠 좌표·overflow clip으로 본문과 함께 스크롤. 컨트롤과 아이콘 자손은 선택/callout/기본 drag 차단, 진입 시 DOM 선택 해제. sidebar 열면 숨김·drag 취소. `MobileBlockMove.vue`, `block-move.ts`.
- PC 본문 손잡이: floating offset 0 + 내부 px-2로 8px 빈 hover 간격 제거 (`drag-handle-options.ts`).
- 애니메이션: 사이드바 폭 전환, 페이지 페이드, `prefers-reduced-motion` 존중
- 모바일 메뉴 이동(2026-10-19): 자동 route watch 닫힘 대신 목적 화면 준비를 기다린 뒤 slide-out. 메뉴 뒤 페이지는 fade 0ms, 일반 탐색은 기존 fade 유지.
- 🔴 dev 서버가 떠 있는 동안 새 폴더를 만들면 그 안의 Tailwind 클래스가 빠질 수 있다 → `touch app/assets/css/main.css`
