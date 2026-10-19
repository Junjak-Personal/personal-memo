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
- watch/effect 기피 (이벤트·훅으로 갱신). 써야 하면 이유를 먼저 적는다
- 템플릿에서 composable 이 돌려준 객체 안의 ref 는 자동으로 풀리지 않는다 → `calendarSync.running.value`
- `shallowRef` 로 외부 객체(DateRange 등)를 그대로 든다

## Cross-Store Dependencies
- `useStructureQueue` → `useMemoTree`, `useActiveMemo` (반영 전에 열린 문서를 먼저 저장)
- 서버 쪽 싱글톤: `useMemoStore()`, `useCalendarSync()` (`server/utils/`) — 프로세스에 하나. 저장소 작업은 `exclusive` 큐로 한 줄로 선다
