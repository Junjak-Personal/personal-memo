# Project Profile

> Generated: 2026-10-07
> Last updated: 2026-10-07
> Profile-Generated-At: 4aa0d56

혼자 쓰는 개인 마크다운 메모 앱. 메모는 N100 서버의 파일시스템(.md + frontmatter)이 원본이고, PC 는 브라우저, 폰은 Flutter 웹뷰 껍데기로 쓴다.
설계 SSOT: `_docs/reference/product-spec/2026-10-06-product-spec.md`

## Quick Summary
- **Stack**: Nuxt 4.6 (SPA, `ssr: false`) + Nitro + TypeScript 6 + Nuxt UI 4 / Tailwind v4 · 폰 껍데기 Flutter
- **Package manager**: pnpm 12.6
- **Test framework**: Vitest 5 (98 tests) · E2E 없음 (Playwright MCP 수동 확인)
- **State management**: Pinia 없음 — `useState` composable + 모듈 변수
- **API layer**: 수동 (Nitro 파일 라우트 + `shared/types` 공용 타입), 생성기 없음
- **CI/CD**: 없음 (배포는 3단계 예정 — pic-blog 의 Dockerfile·deploy.sh·GitHub Actions 복제, 설계문서 §13)

## Profile Files

Relevance: REQUIRED (always read) > HIGH (read if related) > MEDIUM (optional) > SKIPPED (not applicable)

Status tokens: `✅` scanned-from-code · `⏭️` Skipped (not applicable) · `🌱` Seeded.

| File | Relevance | Status | Contents |
|------|-----------|--------|----------|
| [stack.md](./stack.md) | REQUIRED | ✅ | Runtime, framework, dependencies, 검증 명령 |
| [structure.md](./structure.md) | REQUIRED | ✅ | Directory layout, `_modules/`, naming |
| [code-style.md](./code-style.md) | HIGH | ✅ | 형식, import, 주석(한국어·🔴), 타입 규칙 |
| [api-layer.md](./api-layer.md) | HIGH | ✅ | Nitro 라우트, 오류 변환, 인증, 구글 캘린더 |
| [state-management.md](./state-management.md) | MEDIUM | ✅ | useState composable, 대기열, watch 기피 |
| [testing.md](./testing.md) | HIGH | ✅ | Vitest 패턴, 픽스처 주의, agentic adapter |
| [ui-components.md](./ui-components.md) | MEDIUM | ✅ | Nuxt UI, 아이콘, 토큰, 버튼 규칙 |
| deployment.md | — | ⏭️ Skipped (CI/CD·Dockerfile 아직 없음 — 설계문서 §13) | — |

## Key Conventions for Agents

1. **파일시스템이 원본.** 서버가 사용자 파일을 쓰는 경우는 «앱에서 저장»뿐. 저장소 작업은 `MemoStore` 의 `exclusive` 큐로 한 줄로 선다 (`server/memo/store.ts`).
2. **도메인 로직은 Nuxt 밖에.** `server/memo`, `server/calendar` 는 h3 를 모르고 Vitest 로 바로 검사한다. HTTP 변환은 `defineMemoHandler` (`MemoError` → `data.message`).
3. **공용 타입은 `shared/types/`** 에서만 정의하고 서버·화면이 같이 쓴다. 화면에서 도메인 타입을 다시 만들지 않는다.
4. **라우트는 얇게, 로직은 `pages/<route>/_modules/`** (라우트 아님, 자동 import 안 됨 → 명시 import). 페이지 최상위는 감싸개 div 하나, 주석도 그 안에.
5. **watch 기피** — 동작 뒤에 `refresh()`/`recheckSoon()` 같은 이벤트로 갱신한다.
6. **날짜는 `YYYY-MM-DD` 문자열·KST 고정** (`shared/utils/memo-date.ts`). `new Date('YYYY-MM-DD')` 는 UTC 로 읽혀 하루 밀린다.
7. **PC = 폭 1024px 이상, 모바일 = 미만** (Tailwind `lg`). 아이패드는 지원하지 않는다 (iOS 앱은 아이폰 전용).
8. **조용히 실패하지 않는다** — 실패에는 화면에 이유와 다시 시도 수단을 둔다. 사용자 문구는 한국어, 인용은 「」. 버튼은 배경이나 테두리가 있다.
9. **검증 명령**: `pnpm typecheck`(루트 tsc 아님 — vacuous), `pnpm vitest run`. 린터 없음.
10. 🔴 **로컬 `data/` 는 사용자 실제 메모** — 시드·초기화·삭제 금지. 격리는 `NUXT_DATA_DIR=<임시>` + 별도 dotenv.
11. 🔴 **개발에서 구글 캘린더 동기화를 켜지 않는다** — 대조가 모르는 memoId 일정을 지운다. 커밋·푸시·배포는 오너 지시가 있을 때만.

## Document buckets

Lifecycle: active/{planning,processing}/ · complete/ · reference/ · deprecated/   (standard)

| Collection | Holds | Curated by agent? |
|------------|-------|-------------------|
| `intent/`  | request records, head of intent→spec→plan chain | no — append only |
| `handoff/` | live work-stream handoffs | prune-to-latest only |

현재 `_docs/` 에는 `reference/product-spec/`(설계 SSOT — 결정이 바뀌면 같은 변경에서 갱신)와 `complete/spike/` 만 있다. 추가 컬렉션 없음.

## Agent Loading Guide
- **All agents**: Read this `index.md` (REQUIRED)
- **Read additional files when**:
  - File relevance is REQUIRED or HIGH for your role
  - Your task touches that domain
  - File status is ✅ (not ⏭️ Skipped)

## Changelog
- 2026-10-07: 첫 생성 (1·2·4·5단계 완료 시점)
- 2026-10-07: 아이패드 미지원·PC/모바일 1024 경계, `E2E_PASSWORD`, 캘린더 스모크 `scripts/calendar-smoke/` 반영
- 2026-10-07: 태그(frontmatter), 오프라인 보호(`memo-drafts`), 원본 이미지(`.orig`), 공유 시트(`MemoShare`·App Group), 휴지통 자동 비우기 추가 — 설계문서 §3.1·§3.4·§4·§7.2.1·§10.4
