# Tech Stack

## Runtime
- Language: TypeScript (strict) — 웹·서버. Dart — 폰 껍데기(`app-ios/`)
- Runtime: Node 24 (로컬 v24.18.0, 버전 고정 파일 없음)
- Package manager: pnpm 12.6.0
- Detection: `package.json` 의 `packageManager` + `pnpm-lock.yaml`

## Framework
- Framework: Nuxt 4.6.0, **SPA (`ssr: false`)** — 서버 렌더를 켜면 Tiptap 이 prosemirror-state 를 두 벌 올려 500 (S2 실측)
- Server: Nitro (Nuxt 내장) — `server/api/` 파일 라우트
- UI library: Nuxt UI 4.11.3 (UDashboard*, UEditor, UTree, UCalendar …)
- CSS: Tailwind v4 (`app/assets/css/main.css` 의 `@import "tailwindcss"; @import "@nuxt/ui";`)
- 모바일: Flutter + webview_flutter (WKWebView) 껍데기 — 툴바만 네이티브, 나머지는 웹

## Key Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| nuxt | ^4.6.0 | 앱·서버 (minimumReleaseAge 예외 등록 — `pnpm-workspace.yaml`) |
| @nuxt/ui | ^4.11.3 | UI 컴포넌트, 에디터(UEditor) |
| @tiptap/* | 3.31.4 (고정) | 에디터 확장 (TaskList·TableKit·Emoji 등) |
| tiptap-extension-code-block-shiki / shiki | 1.2.0 / 4.5.0 | 코드 블록 강조 |
| nuxt-auth-utils | 0.5.30 | 봉인 쿠키 세션, 비밀번호 1개 |
| @adonisjs/hash | 9.1.1 (dev) | scrypt 해시 |
| yaml | 2.9.1 | frontmatter (Document API 로 모르는 키 보존) |
| @internationalized/date / reka-ui | ^3.12.4 / 2.10.5 | 날짜 고르기(UCalendar) |
| typescript | ^6.0.3 | 🔴 7.x 는 vue-tsc 가 못 돈다 (`ERR_PACKAGE_PATH_NOT_EXPORTED`) |
| vitest | ^5.0.3 | 단위 테스트 |
| @iconify-json/material-symbols, lucide | — | 로컬 아이콘 (외부 API 안 씀) |

구글 캘린더는 SDK 없이 `node:crypto`(JWT RS256) + `fetch` (`server/calendar/google.ts`).

## Build (pnpm)
- Dev: `pnpm dev` (= `nuxt dev --dotenv .env.local`, 포트 4700). 폰에서 붙을 땐 `pnpm dev --host 0.0.0.0`
- Build: `pnpm build`
- Test: `pnpm test` (= `vitest run`)
- Install: `pnpm install`
- Worktree deps fast-path: **A·copy-based** — `pnpm install --frozen-lockfile --prefer-offline`. `app-ios/` 는 **B·reference-cache** — `cd app-ios && flutter pub get` (fvm 설치돼 있으나 `.fvmrc` 없음 → 홈브루 flutter)
- Audit: `pnpm audit`

## Build & Verify — AUTHORITATIVE commands
- Type-check (authoritative): `pnpm typecheck` (= `nuxt typecheck` → vue-tsc, `.nuxt/tsconfig.{app,server,shared,node}.json` 참조)
  - 🔴 루트 `tsconfig.json` 은 `"files": []` 인 참조 묶음이다 — `tsc --noEmit` 를 루트에서 돌리면 아무것도 검사하지 않는다
  - Vacuity-checked: yes — 2026-10-07 `app/utils/`·`server/memo/` 에 일부러 넣은 TS2322 를 둘 다 잡음
  - 성공하면 아이콘 번들 안내 두 줄만 나오고 끝난다 (오류 0)
  - Pre-existing error baseline: 0
- Lint (authoritative): 없음 (ESLint·Prettier·Biome 설정 없음) — baseline N/A
- Test (authoritative): `pnpm vitest run` — 2026-10-07 기준 11 파일 98 테스트 수집·통과
