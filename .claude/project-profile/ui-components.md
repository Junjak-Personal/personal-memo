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
- Colors: `app/app.config.ts` — primary `navy`(강조에만), neutral `neutral`. 기본은 흰색·검정·회색
  `main.css` — navy 50~950, `--ui-primary` 라이트 700 / 다크 300, 다크 바탕 `neutral-950`
- Typography: Pretendard Variable (CDN, `nuxt.config` head) — `ui.fonts: false`
- 다크: 시스템 설정을 따른다
- 확대·축소 금지 (viewport + `plugins/no-pinch-zoom.client.ts`), `touch-action: manipulation`
- 안전 여백: `env(safe-area-inset-*)` (dashboardPanel body·사이드바 footer)

## Common Patterns
- 버튼: 배경이나 테두리가 반드시 있다. 헤더·툴바 = 아이콘 ghost, 섹션 = outline, 모달 하단 = 취소(outline) > 확인(default), 위험 = error
- 모달: `UModal` + `#body` + `#footer`(오른쪽 정렬)
- 실패·경고 안내: `UAlert` (subtle) + actions, 짧은 결과는 `useToast()`
- 저장 상태 같은 바뀌는 글자는 폭 고정 (툴바 밀림 방지 — `MemoSaveStatus.vue`)
- 폰 목록: 사이드바 slideover 전체 화면 (`mode="slideover"`)
- PC 끌어 놓기, 폰은 메뉴(다른 폴더로 옮기기)
- 애니메이션: 사이드바 폭 전환, 페이지 페이드, `prefers-reduced-motion` 존중
- 🔴 dev 서버가 떠 있는 동안 새 폴더를 만들면 그 안의 Tailwind 클래스가 빠질 수 있다 → `touch app/assets/css/main.css`
