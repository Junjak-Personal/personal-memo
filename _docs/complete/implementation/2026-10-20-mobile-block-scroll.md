# 모바일 블록 모드 선택·스크롤 회귀 수정

- 상태: **fixed but unverified** — 자동 검사·Chromium 개발 화면 통과, iPhone Safari/Flutter WebView 실기기 터치 검증 남음.
- 기준: `c5c315017dc505fde5e9122917912d6c8fc43c6a`, `codex/fix-mobile-block-scroll`.
- 저장소: `Junjak-Personal/personal-memo`. 원본 checkout·실제 메모·기존 미추적 두 경로 보존. 최초 검증 시 신규 커밋·push·운영 배포 없음. 아래 승인 이후 배포 진행 기록 참고.

## 증상과 원인

사용자 iPhone 사진에서 + 아이콘의 파란 텍스트 선택과 Copy/Translate 메뉴가 보였고, 다른 사진에서는 손잡이들이 본문과 다른 위치로 이동했다.

`MobileBlockMove.vue`는 에디터 본문에만 선택 차단 클래스를 적용했다. 컨트롤은 panel에 Teleport된 형제 레이어여서 해당 CSS 범위 밖이었다. 특히 +는 선택 차단과 context menu 방지가 없었다.

컨트롤은 viewport `fixed` 좌표, scroll 이벤트/rAF 재측정, 화면 위쪽으로 손잡이를 붙이는 clamp, 화면 밖 행 필터링을 조합했다. 본문의 네이티브 스크롤과 다른 좌표계라 재측정 전에는 본문을 따라갈 수 없었다. Safari 엔진 내부 원인 자체를 실기기로 재현했다고 주장하지 않는다.

## 변경

- 기존 `relative` EditorContent 래퍼 안으로 Teleport하고 `absolute` 콘텐츠 좌표로 배치한다. idle 스크롤은 JS 실행 전에도 같은 부모와 함께 이동한다. 상단 clamp·viewport 필터·fixed clip을 제거했다.
- 컨트롤은 `overflow: clip`으로 자체 스크롤 컨테이너를 만들지 않는다. 기존 panel이 본문·컨트롤을 함께 스크롤한다.
- 드래그 hit test는 최신 viewport 좌표, 손잡이·삽입선은 래퍼 로컬 좌표를 사용한다. 가장자리 자동 스크롤 때도 포인터 위치를 유지한다.
- 진입 시 남아 있던 DOM 선택을 지우고, 컨트롤 전체와 아이콘 자손에 `user-select`, `-webkit-user-select`, `-webkit-touch-callout`, 기본 이미지 드래그 차단을 적용했다. +와 손잡이는 draggable=false, 레이어의 selectstart/contextmenu/dragstart 기본 동작을 차단한다.
- 기존 작은 아이콘·간격·44px 터치 영역, +의 기존 블록 메뉴 연결, 문서 이동/undo, sidebar·권한·문서 변경 취소 흐름을 유지했다.

## 검증

수정 전에 실제 SFC setup/템플릿을 실행하는 회귀 검사에서 6개 실패·11개 통과를 확인했다. 래퍼 좌표 기준·스크롤 재측정 지연·선택 제거의 실패였다. 수정 후 가장자리 자동 스크롤과 드롭 좌표 검사도 추가했다.

- 집중 검사: 18개 통과.
- 전체 Vitest: **31파일 306개 통과**, exit 0.
- Nuxt typecheck: exit 0.
- Nuxt build: exit 0, 10.2초.
- `git diff --check`: 통과.
- Chromium 390×740, 별도 합성 데이터·로컬 테스트 인증, 캘린더 동기화 비활성 상태에서 확인.
  - panel scrollTop 765.5 → 292. 본문 y 570.5 → 1044, 손잡이 y 562.5 → 1036. **둘 다 +473.5px**, 상대 간격 -8px 유지.
  - 레이어 absolute/overflow clip, 자체 scrollTop 0, 버튼과 내부 icon userSelect none.
  - 긴 문단·목록에서 정렬 확인. 방향키 이동 후 순서 변경과 undo 원상 복구 확인. + 클릭 후 기존 블록 메뉴 열림·편집 복원 확인.
- 실제 iOS 길게 누르기/선택 메뉴와 손가락 drag·관성 스크롤·edge auto-scroll은 아직 미검증이다. 브라우저 수동 검증은 방향키 이동, 포인터 이동·취소·드롭은 실제 SFC setup 자동 검사로 검증했다.

로컬 증거: `_workspace/e2e/2026-10-20-mobile-block-scroll/{red,tests,typecheck,build}.log`, `mobile-scroll.png`. 테스트 서버는 검증 뒤 종료했고 임시 viewport override를 복원했다.

## 배포 승인 (2026-10-20 KST)

- 사용자 「ㅇ 배포」로 검증한 수정본의 배포를 승인했다.
- 사전 fetch 결과 origin/main은 기준 c5c3150과 일치했다. 코드 변경 없이 로컬 306개 테스트·타입 검사·빌드 통과 결과를 사용한다.
- 대상 파일만 커밋 후 main fast-forward push로 기존 Deploy workflow를 실행한다. 실제 메모·기존 미추적 파일·인증·권한·iOS 앱 설치는 변경하지 않는다.
- 공개 배포 전 상태: health ok, Nuxt build 3dc84530-8f3b-4b45-8ff2-738709f47a02. 운영 반영·workflow 최종 상태는 별도 배포 결과로 확인한다.
