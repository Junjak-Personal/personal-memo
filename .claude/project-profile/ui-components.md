# UI Components

## Component Library
- Name: Nuxt UI 4 (+ reka-ui). 레이아웃은 nuxt-ui-templates/dashboard·editor 구조 (UDashboardGroup / UDashboardSidebar / UDashboardPanel / UDashboardNavbar)
- Import pattern: 자동 import (`U*`). `_modules/` 안의 자체 컴포넌트는 명시 import
- 에디터: `UEditor` + `UEditorToolbar`(상단·말풍선·이미지·표) + 슬래시 메뉴·끌기 손잡이 — `app/pages/m/_modules/editor/items.ts`
- 🔴 페이지 최상위는 감싸개 div 하나 — UDashboardPanel 은 단일 루트가 아니라 화면 전환이 멈춘다. 주석도 div 안에 둔다

## 본문 컬럼·트리 갱신 (2026-11-05)
- `memoColumnsKit()`을 공통 확장에 등록한다. 툴바 「열 배치」와 슬래시 메뉴에서 2·3·4열을 선택하며, 축소·해제는 내용을 순서대로 보존한다. 저장은 `data-memo-columns`·`data-memo-column` HTML, 639px 이하에서는 세로 배치다.
- 사이드바의 「트리 새로고침」은 대기 중 변경을 반영한 뒤 기존 `refresh()`를 호출한다. 펼침·선택·스크롤·입력을 유지하며 실패 시 기존 트리를 남긴다.

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

- 사이드바 검색과 트리/검색 결과 간격(2026-10-21): DashboardSidebar 기본 gap-4 대신 body gap-2(8px)를 PC·모바일 공통 적용한다. 이동 상태 sr-only 안내는 레이아웃 공간을 차지하지 않는다.
- 사이드바 검색 입력·빠른 열기 버튼 높이(2026-10-22): PC는 둘 다36px, 모바일은 둘 다44px로 일치시킨다. 입력 base h-11 lg:h-9와 버튼 size-11 lg:size-9로 같은 경계를 사용한다.
- 로딩 높이 안정화(2026-10-21): `MemoLoadingRegion`은 직전 실제 높이만 로딩 동안 유지하고 absolute·pointer-events-none spinner와 sr-only 상태를 제공한다. 빠른 열기는 dvh 제한 목록 viewport + 입력 spinner(높이 보존 옵션 해제), 검색은 입력 spinner, 이력/템플릿은 목록·preview 유지와 내부 spinner, 참조 목록은 기존 새로고침 spinner. 별도 loading 텍스트 행은 넣지 않는다. 오류·빈 결과 안내는 유지한다.
- 빠른 탐색(2026-10-21): MemoQuickSwitch를 Sidebar 바깥 sibling modal로 한 번 장착한다. 검색 옆 버튼/⌘K·Ctrl+K, 즐겨찾기·최근·기존 검색과↑↓/Enter/Esc/IME. PC shortcut은 capture에서 한 번 처리해 editor 링크 단축키와 중복되지 않는다. 최근 정상 mounted 문서만 기록한다.
- 수정 이력(2026-10-21): MemoActions→MemoHistoryDialog. 시간/제목 목록과 escape된 원문 preview, 명시 확인 후 복원. 409는 현재 메모 재조회 선택 제공. 실제 PC/iPhone 화면 QA는 구현 archive의 pending5개를 따른다.
- 첫 실행 splash(2026-10-20): app/spa-loading-template.html(body 밖 loader) → StartupSplash.vue. Memo 책·펜 로고48px/글자28px, 시스템 색/동작 줄이기. 페이지·tree·메모 에디터 실제 준비 뒤 제거, SPA 이동 중 재표시 없음. 기존 설치 앱은 새 채널 없이 웹 표식을 사용한다. native 별도 MemoStartup 채널/current state probe·assets/memo-logo.png 등록은 후속 로컬 작업이며 웹 배포 커밋에서 제외했다.
- 표 내용 폭(2026-10-20): PC/모바일 공통 `width:max-content` + `table-layout:auto`로 실제 글꼴/내용에 열을 맞춘다. 임의 최소 폭·문서 폭 채우기 없음. th/td white-space:pre로 자동 개행 없이 직접 개행 유지. 넓은 표만 기존 tableWrapper 안 가로 스크롤. 원문/스키마 변경 없음.
- 모바일 손잡이 터치 예외(2026-10-20): 전역 main.css touch-action은 비레이어이므로 Tailwind touch-none만으로는 이기지 못한다. `.mobile-block-move-handle`의 비레이어 `touch-action: none`으로 드래그→스크롤 인계(pointercancel)를 막는다. 드래그 아이콘은 translate 없이 44px 버튼 정중앙, +만 기존 translate-x-2 유지.
- 병합 표 테두리(2026-10-20): `table-layout.ts`의 ProseMirror TableMap decoration으로 실제 위/왼쪽 외곽과 네 모서리를 표시한다. DOM first/last-child는 rowspan 아래 내부 셀을 오판하므로 쓰지 않는다. 기본 아래/오른쪽 선에 외곽 위/왼쪽 선만 추가한다. 표시 class는 저장 내용에 포함되지 않는다. 일반/HTML 표에 동일 적용.
- 표 저장 유형(2026-10-20): `memoTableKit()`은 같은 table schema의 `memoTableFormat`으로 markdown/html을 구분한다. GFM 출력은 기존 그대로, HTML은 `data-memo-table="html"`과 span을 저장해 병합 해제 후에도 HTML 유지. 공통 확장이어서 편집/외부 보기 동일. 사람용 표 UI·병합 버튼은 변경 없음. 1~1000 정수 span, 스키마 serializer·선택적 형식 비교 유지. `editor-table.ts`, `canonical-table-html.ts`.
- 버튼: 배경이나 테두리가 반드시 있다. 헤더·툴바 = 아이콘 ghost, 섹션 = outline, 모달 하단 = 취소(outline) > 확인(default), 위험 = error
- 모달: `UModal` + `#body` + `#footer`(오른쪽 정렬)
- 실패·경고 안내: `UAlert` (subtle) + actions, 짧은 결과는 `useToast()`
- 저장 상태 같은 바뀌는 글자는 폭 고정 (툴바 밀림 방지 — `MemoSaveStatus.vue`)
- 폰 목록: 사이드바 slideover 전체 화면 (`mode="slideover"`)
- 하단 탐색: 할 일·캘린더·태그 아이콘과 ⋯ 메뉴(휴지통·AI 연결·로그아웃). 할 일 수·오늘 일정은 빨간 뱃지. 태그 목록은 `/tags` 전용 화면. (원격 2026-10-18 변경 유지)
- PC 끌어 놓기, 폰은 메뉴(다른 폴더로 옮기기)
- 본문 블록 이동(2026-10-20 후속): 상단 이동/완료 체크는 기존 메모 메뉴와 같은 UButton neutral/ghost·20px. 본문 왼쪽 +·손잡이는 ghost sm(16px), + glyph만 안쪽으로 8px 당기고 드래그 glyph는 중앙 정렬, 각 44px 터치 영역과 모드 한정 padding-left 72px. +는 편집 복원 후 PC와 같은 suggestion handler로 해당 블록 아래 추가. 별도 버튼 CSS/시각 컨테이너/텍스트/안내/이동 모달 없음. 드래그·방향키·undo/redo, 본문 비편집·스크롤, 종료 시 편집/padding 복원. 목록·표 전체 이동, 평소 long press 선택 유지. 손잡이는 relative EditorContent 래퍼에 Teleport·absolute 콘텐츠 좌표·overflow clip으로 본문과 함께 스크롤. 컨트롤과 아이콘 자손은 선택/callout/기본 drag 차단, 진입 시 DOM 선택 해제. sidebar 열면 숨김·drag 취소. `MobileBlockMove.vue`, `block-move.ts`.
- PC 본문 손잡이: floating offset 0 + 내부 px-2로 8px 빈 hover 간격 제거 (`drag-handle-options.ts`).
- 애니메이션: 사이드바 폭 전환, 페이지 페이드, `prefers-reduced-motion` 존중
- 모바일 메뉴 이동(2026-10-19): 자동 route watch 닫힘 대신 목적 화면 준비를 기다린 뒤 slide-out. 메뉴 뒤 페이지는 fade 0ms, 일반 탐색은 기존 fade 유지.
- 🔴 dev 서버가 떠 있는 동안 새 폴더를 만들면 그 안의 Tailwind 클래스가 빠질 수 있다 → `touch app/assets/css/main.css`

## 목차·링크·내 템플릿 (2026-10-21)
- `MemoOutline` 헤더 팝오버: 단계별 목차·이동·접기, 모바일44px 컨트롤. 블록 모드는 펼친 후 비활성화.
- `MemoLinkSuggestions`: `[[` caret 팝오버·기존 메모 선택/명시 생성·폴더 구분·키보드/IME. `MemoBacklinks`는 editor 밖 문서 하단 목록이다. 공개 `ExtMemo`는 공개 tree에서 허용한 내부 링크만 `/ext`로 연결하고 나머지는 href 제거·이벤트 경계로 차단한다. 일반 링크는 읽기 전용에서도 openOnClick을 켠다.
- `MemoActions`→`MemoSaveTemplateDialog`; Sidebar 더보기→`MemoTemplatesDialog`. 관리창 원문은 escaped pre이며 이름 변경·삭제 확인·root 포함 폴더 선택·새 메모 생성/생성 후 이동 오류를 처리한다. 실제 PC/iPhone 화면은 별도 미검증이다.

## 폴더 공개·공개 탐색 (2026-11-04 로컬 구현)

AppSidebar 폴더 메뉴→FolderPublicDialog에서 하위·향후 항목 공개를 확인한다. 상위 공개를 상속하는 항목의 개별 해제는 비활성화하며 링크 복사는 허용한다. 공개 ExtLayout은 `/api/ext/tree`만 사용하고 ExtFolder/ExtMemo를 LNB와 함께 표시한다. 비공개 조상은 그리지 않는다. 모바일 목록·저장 실패 흐름은 완료 기록의 QA2개 pending이다.
