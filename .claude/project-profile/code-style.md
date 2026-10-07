# Code Style

## Formatting
- Tool: 없음 (설정 파일 없음 — 기존 코드 모양을 따른다)
- Semicolons: 없음
- Quotes: 작은따옴표
- Indent: 2칸
- 줄 길이: 길게 허용 (~150자). 끝 쉼표 있음
- 템플릿: 속성이 많으면 한 줄에 하나

## Import Patterns
- Alias: 화면은 `#shared/...`, `~/utils/...`. 🔴 서버(`server/memo`, `server/calendar`)는 상대경로 `../../shared/...` — Vitest 가 Nuxt 없이 돈다
  (vitest.config 에 `#shared` 별칭은 있으나 기존 서버 코드는 상대경로)
- Style: named import, `import type` 분리. 자동 import(composables, utils, Nuxt/Vue API, server/utils)는 import 하지 않는다
- `_modules/` 안의 컴포넌트·함수는 자동 import 대상이 아니라 명시적으로 import
- Ordering: 외부 → `#shared` → `~` → 상대경로 (수동)

## Naming
- Variables / Functions: camelCase
- Types/Interfaces: PascalCase. 상태 변형은 판별 유니온 (`SaveState`, `StructureOp`, `CalendarSyncStatus`)
- Constants: SCREAMING_SNAKE (`DELAY_MS`, `MAX_LANES`, `SYNC_DEBOUNCE_MS`)
- data-testid: `{page}-{element}-{action}` (예: `memo-save-status`, `calendar-sync-run`)

## Comments
- 한국어. «왜»를 적는다 (무엇은 코드가 말한다)
- 🔴 = 실제로 겪은 함정·하드 규칙. 날짜와 함께 («2026-10-07 사용자 지적»)
- 설계문서 절 번호로 이어 준다 (`(설계문서 §8.3)`)
- 사용자에게 보이는 문구는 한국어, 인용은 「」. i18n 은 쓰지 않는다 (한국어 단일 사용자 앱)

## Type Rules
- `any` 금지. `unknown` 은 밖에서 온 값(구글 응답, `catch`, `readBody`)에서만 받고 바로 가드로 좁힌다 (`isRecord`, `isFetchError`)
- 공용 타입은 `shared/types/` 에서 파생 (`Pick`, `Omit`, `extends`)

## Code Ordering
전역 규칙(`~/.claude/CLAUDE.md`)의 10단계 순서: 프레임워크 훅 → 전역 상태 → 페이지 상태 → 데이터 가져오기 → 로컬 상태·파생 →
초기화 → watch → 생명주기 → 핸들러 → 반환. 예: `app/pages/calendar/_modules/CalendarView.vue`

## Reactivity
- watch/effect 를 피한다 — 이벤트로 refresh 를 부른다 (예: 저장 성공 → `refreshTree()`, `calendarSync.recheckSoon()`)
- watch 를 써야 하면 이유를 먼저 적는다
