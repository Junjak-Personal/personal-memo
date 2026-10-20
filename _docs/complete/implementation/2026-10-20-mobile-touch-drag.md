# 모바일 손잡이 터치 드래그 취소·아이콘 정렬 수정

- status: complete
- verdict: fixed
- baseRef: b7cb351f72169eadcba014932bea5309d9e36b19
- branch: codex/mobile-touch-drag
- 사용자 증상: 손잡이를 끌면 삽입선이 잠깐 나타났다 사라짐. 본문 쪽으로 끌어야 선이 나타나기도 함. hover 배경의 오른쪽 여백이 왼쪽보다 큼.

## 원인과 수정

실제 Nuxt 개발 앱의 Chrome 390×844 터치 에뮬레이션에서 `pointerdown(touch)` 직후 `pointercancel(touch)`를 재현했다. 계산된 손잡이/아이콘 touch-action은 `manipulation`이었다. main.css의 비레이어 `:where(*)` 선언은 specificity가 낮더라도 Tailwind utilities 레이어의 `touch-none`보다 우선한다. Pointer Events의 직접 조작 판정은 제스처 시작 당시 touch-action에 따르므로 pointerdown의 preventDefault나 capture만으로 스크롤 인계를 막을 수 없다.

- 손잡이에 비레이어 `.mobile-block-move-handle { touch-action: none }`을 선언한다. 본문/추가 버튼의 스크롤 동작은 유지한다. 드롭·취소·자동저장·undo 로직 변경 없음.
- 드래그 아이콘의 `-translate-x-2`를 제거해 44px 버튼 중앙에 놓는다. 실제 아이콘/버튼 중심 차이 0px 확인. +의 기존 간격 조절은 유지한다.
- main.css의 잘못된 우선순위 설명을 바로잡는다. 임시 진단 로그는 최종 코드에서 제거했다.
- 기존 SFC setup 검사에 touch 포인터의 실제 템플릿 바인딩→window move/up→왼쪽 세로 드롭→undo/redo 회귀를 추가했다. 이 Node 검사는 CSS cascade 검증을 대체하지 않는다.

## 실제 검증

- 전체 Vitest: 33파일 333개 통과, exit 0. 기존 자동 스크롤/좌표 동행/취소/정리/저장 transaction 회귀 포함.
- Nuxt typecheck: exit 0. Nuxt build: exit 0 (10.6초). 생성된 MobileBlockMove CSS의 비레이어 touch-action:none과 JS의 중앙 정렬도 확인.
- Chrome 실제 Nuxt 개발 앱: 격리된 합성 긴 문서만 사용. 수정 전 pointercancel과 manipulation, 수정 후 none을 확인했다. 본문으로 가로 이동하지 않고 왼쪽에서 세로 드롭 3회, 목록 전체 이동, 실행 취소, 스크롤 후 13번째→14번째 이동을 확인했다. 진단 로그 제거 후 최종 코드에서도 재확인했다.
- 본문 스크롤 후 콘텐츠와 손잡이가 같은 위치로 이동함을 확인. 아이콘 중심 차이 0px. 드래그 중 가장자리 장시간 유지에 따른 연속 스크롤은 CUA 드래그가 즉시 release하는 한계로 브라우저 실측하지 못했고 기존 자동 스크롤 단위 검사로 확인했다.
- 증거: `_workspace/e2e/2026-10-20-touch-drag/`의 before-css-diagnostic.txt, after-css-diagnostic.txt, after-touch.png, final-touch.{png,txt}, tests.log, typecheck.log, build.log.
- iPhone Safari/Flutter WKWebView 실기기에서 같은 세로 드래그와 가장자리 장시간 유지 스크롤은 사용자 재확인이 필요하다. 이번 수정은 공통 웹 CSS이며 네이티브 설치/권한 변경 없음.
- 실제 사용자 메모·운영 데이터·원본 checkout·미추적 두 경로 보존. 새 의존성 없음. 기존 완료 후 배포 승인에 따라 빌드까지 통과한 뒤 정상 Actions 경로로 후속 배포한다.

## 재현/수용 절차

1. 캘린더가 꺼진 별도 dotenv·임시 데이터로 Nuxt 개발 앱을 띄운다. 운영/실제 data 사용 금지.
2. 긴 합성 메모에서 블록 모드 진입, touch-action 계산값은 손잡이 none, 본문 manipulation이어야 한다.
3. 손잡이를 왼쪽 영역 안에서 세로로 끌어 여러 블록 사이로 놓는다. 삽입선이 중간에 사라지거나 스크롤 제스처에 인계되지 않고 한 번 이동해야 한다.
4. 본문은 스크롤 가능하고 손잡이가 본문과 함께 움직여야 한다. 스크롤 후 드롭·목록 전체 이동·undo/redo·완료 후 편집 복원을 확인한다.
5. 실제 기기에서 화면 위/아래 끝에 드래그를 유지하면 그 방향으로만 스크롤하며 놓을 때 최신 삽입 위치로 이동하는지 확인한다.

참고: [W3C Pointer Events의 직접 조작 판정](https://www.w3.org/TR/pointerevents3/#determining-supported-direct-manipulation-behavior).
