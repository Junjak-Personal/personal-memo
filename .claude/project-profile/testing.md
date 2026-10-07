# Testing

## Frameworks
| Type | Framework | Config | Location |
|------|-----------|--------|----------|
| Unit | Vitest 5.0.3 (node 환경) | `vitest.config.ts` (`#shared` 별칭) | 대상 옆 `*.test.ts` — `shared/**`, `server/**`, `app/**` |
| Integration | Vitest — 저장소를 실제 임시 폴더(mkdtemp)에 돌린다 | 같음 | `server/memo/store.test.ts` |
| HTTP 스모크 | node 스크립트 (저장소 밖, 세션 scratchpad) | — | 미추적 |
| E2E | 없음 (Playwright 패키지 미설치). 화면 확인은 Playwright MCP 수동 | — | — |

## Test Commands
- All: `pnpm test` (= `vitest run`)
- 파일 하나: `pnpm vitest run server/calendar`
- E2E: 없음
- Coverage: 설정 없음

## Patterns
- 파일 이름: `*.test.ts`, 대상과 같은 폴더
- Nuxt 런타임 없이 도는 것만 단위 테스트한다 → 로직을 `server/memo`, `server/calendar`, `app/utils`, `_modules/*.ts` 의 순수 함수로 뺀다
- 외부 API 는 흉내 객체로: `FakeCalendar implements CalendarApi`, 가짜 `fetch` (`server/calendar/*.test.ts`)
- 파일시스템은 진짜 임시 폴더 + `utimes` 로 외부 편집 흉내 (`store.test.ts` 의 `externalWrite`)
- 시간은 `vi.useFakeTimers()` / 주입 `now`
- 테스트 이름은 한국어 문장 («하루짜리는 다음 날이 끝이다 …»)

## Coverage
- Target: 없음

## E2E Fixtures
- E2E account: 비밀번호 하나 (계정 개념 없음)
- Credentials source: `.env.local` 의 `NUXT_ADMIN_PASSWORD_HASH` (해시만). 평문 개발 비밀번호는 오너가 안다 — [FILL: 자동 실행용 env 이름 미정]
- Test-data seed: 없음. 🔴 로컬 `data/` 는 사용자 실제 메모(「342」 폴더 등) — 시드·초기화 금지.
  격리가 필요하면 `NUXT_DATA_DIR=<임시 폴더>` 로 서버를 따로 띄운다 (별도 dotenv: `pnpm exec nuxt dev --dotenv <파일>`)
- Fixture files: [FILL: 이미지 업로드 시험용 파일 없음]
- Target env: 로컬만 (http://localhost:4700). 운영 미배포
- Shared-resource caution: dev 서버 하나가 :4700 을 쓴다 — `.nuxt` 를 같이 써서 같은 폴더에서 둘을 동시에 못 띄운다. 폰 앱(「memo dev」)이 이 서버에 붙어 있다.
  구글 캘린더: 개발 기본 꺼짐. 실제 「메모」 캘린더로 시험하면 시작·끝 일정 수가 같은지 확인
- Teardown: 임시 데이터 폴더를 쓰면 필요 없음. 실제 캘린더 시험은 만든 memoId 일정을 지운다
- Device targets: iOS 실기기 (개발용 설치 `app-ios/tool/dev-install.sh`, 번들 `win.jundevlog.memo.dev`). 시뮬레이터는 xcrun simctl 사용 가능
- Launch command: `app-ios/tool/dev-install.sh` (맥 와이파이 IP 로 붙는다 — `.local` 이름은 이 네트워크 DNS 가 잘못 푼다) · version pin: 없음
- Host-OS gate: iOS = macOS 전용

## Agentic Testing Adapter
- Surface: web (Nuxt SPA). 폰은 같은 웹을 WKWebView 로 감싼 것 — 네이티브는 툴바만
- Driver: agent-browser (CLI 있음) · 대안 playwright-mcp (이 프로젝트에서 실제로 써 온 것)
- Emitter house-style: reference/e2e-testing.md
- Concurrency: serial-shared-browser
- Generated spec dir: tests/e2e/ (아직 없음)
