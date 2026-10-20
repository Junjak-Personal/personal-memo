# State Management

## Library
- Name: 없음 (Pinia 미사용). Nuxt `useState` + composable + 모듈 변수
- Store types: 전역 키 상태 / 모듈 변수(타이머·활성 문서) / 컴포넌트 로컬 ref

## Store Patterns
### Pattern 1: 전역 키 상태 composable
- Scope: 앱 전체 (`useState('memo-tree')`, `'structure-ops'`, `'calendar-sync'`)
- Lifecycle: 앱이 떠 있는 동안
- File location: `app/composables/useXxx.ts`
- Example: `app/composables/useMemoTree.ts` (tree + refresh), `useCalendarSyncStatus.ts`
- 갱신은 동작 뒤에 `refresh()` 를 부른다 — watch 로 따라가지 않는다

### Pattern 2: 모듈 변수 (composable 파일 최상위)
- Scope: 앱 전체, 반응형이 필요 없는 것 (디바운스 타이머, 열린 문서의 flush 함수)
- Example: `useActiveMemo.ts` 의 `active`, `useStructureQueue.ts` 의 `timer`/`applying`

### Pattern 3: 낙관적 반영 + 지연 실행 대기열
- `useStructureQueue`: 폴더 구조 변경을 `ops` 에 쌓고 `view = applyStructureOps(tree, ops)` 로 바로 보여준 뒤 3초/5초 뒤 서버에 순서대로 반영
- 순수 함수 `app/utils/tree-ops.ts` (+ 테스트)

### Pattern 4: 페이지 로컬
- 문서 화면(`MemoDocument.vue`)의 title/content/date 와 `useMemoAutosave` (1초 디바운스, SaveState 판별 유니온)

### 화면 이동/복원 (2026-10-19)
- `useMobileMenuNavigation`: 모바일 drawer open/pending과 요청 sequence. 메뉴가 열린 라우트는 본문 페이드를 생략하고 새 페이지/메모 mounted 뒤 drawer를 닫는다.
- `useLastScreen` + `last-screen.global`/client plugin: 네 화면의 주소만 localStorage `memo-last-screen-v1`에 저장. 앱 최초 `/` 진입만 복원, 세션 id+loggedInAt별 격리.
- 삭제/읽기 불가 메모·없는 태그는 인증된 tree 메타로 검증하며 실패 시 홈. 연속 이동·세션 변경 중 늦은 저장/복원을 revision으로 무효화한다.

## Reactivity Rules

- 탐색(2026-10-21): useMemoNavigation은 NuxtApp별 controller와 session scope 동기 watcher를 사용한다. 서버 ID 목록은 owner 저장소에 영구 보관하고 브라우저의 이전 세션·늦은 GET/검색은 무효화한다. 방문·별표 쓰기는 직렬화, 빠른 탐색을 열 때 tree/목록을 갱신한다.
- 이력 UI: useMemoHistory는 창·선택 요청 revision과 session scope로 늦은 제목/원문을 버린다. flush 후 autosave.currentVersion을 기준으로 복원하며 새 서버 버전 조회로409를 우회하지 않는다. 성공은 activeMemo.reload + tree refresh.
- 초기 tree 공유(2026-10-20): useMemoTree의 NuxtApp별 WeakMap controller. ensure는 현재 요청/유효 결과 재사용, refresh는 새 revision, settled는 같은 세션의 최신 요청 최종 결과 대기(실패 자동 retry 없음). 세션 sync watcher로 tree/error 즉시 초기화·늦은 응답 차단. 메모리 한정이며 runtime별 격리.
- 초기 준비 계측: startup.client의 window.memoStartup 및 html data-memo-startup에 상태/숫자만 남긴다. treeRequests는 실제 controller fetch 시작 수, 나머지 요청 시간은 ResourceTiming 관측분만 존재한다. 경로/계정/메모 정보는 노출하지 않는다.
- watch/effect 기피 (이벤트·훅으로 갱신). 써야 하면 이유를 먼저 적는다
- 템플릿에서 composable 이 돌려준 객체 안의 ref 는 자동으로 풀리지 않는다 → `calendarSync.running.value`
- `shallowRef` 로 외부 객체(DateRange 등)를 그대로 든다

## Cross-Store Dependencies
- `useStructureQueue` → `useMemoTree`, `useActiveMemo` (반영 전에 열린 문서를 먼저 저장)
- 서버 쪽 싱글톤: `useMemoStore()`, `useCalendarSync()` (`server/utils/`) — 프로세스에 하나. 저장소 작업은 `exclusive` 큐로 한 줄로 선다

## 목차·링크·템플릿 상태 (2026-10-21)
- 목차는 ProseMirror plugin state/decoration이며 본문 attrs/undo를 변경하지 않는다. 선택·명시 이동·PC찾기·블록 모드 진입에서 숨은 범위를 펼친다.
- 내부 링크는 inline atom의 ID/작성 label을 표준 Markdown으로 저장한다. 최신 tree 제목은 NodeView DOM에만 반영한다. 입력 query·doc/session scope가 달라지면 늦은 자동완성 삽입을 버린다.
- `useMemoBacklinks`는 문서/session 변경 즉시 초기화하고 늦은 응답을 무시한다. 공개 화면은 최신 비공개 제목/백링크를 요청하지 않는다.
- `useMemoTemplates`/`useSaveMemoTemplate`은 모달별 revision과 session scope를 사용한다. 생성 전 구조 queue→현재 편집 flush, 저장은 flush 후 ID/버전을 캡처한다. 생성 성공 뒤 탐색 실패는 created 메모를 유지해 중복 POST를 막는다.
