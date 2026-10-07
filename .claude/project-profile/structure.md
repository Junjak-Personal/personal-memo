# Project Structure

## Directory Layout
```
personal-memo/
├── app/                      # Nuxt 앱 (SPA)
│   ├── app.config.ts         # Nuxt UI 색(primary navy, neutral) + 컴포넌트 슬롯 기본값
│   ├── assets/css/main.css   # Tailwind v4 + 테마 토큰
│   ├── components/           # 전역 컴포넌트 (AppSidebar, FolderPickDialog …)
│   ├── composables/          # 전역 상태·동작 (useMemoTree, useStructureQueue …)
│   ├── layouts/default.vue   # UDashboardGroup + 사이드바
│   ├── middleware/auth.global.ts
│   ├── pages/                # 라우트 — 얇게. 로직은 같은 폴더의 _modules/
│   │   ├── calendar/{index.vue,_modules/}
│   │   ├── m/{[id].vue,_modules/}       # 메모 문서 (에디터)
│   │   ├── trash/{index.vue,_modules/}
│   │   ├── todo/{index.vue,_modules/}   # 할 일 모아 보기 (설계문서 §3.5)
│   │   ├── index.vue, login.vue
│   ├── plugins/              # *.client.ts
│   └── utils/                # 순수 함수 (+ *.test.ts)
├── server/
│   ├── api/                  # Nitro 파일 라우트 (*.get.ts, *.post.ts …)
│   ├── memo/                 # 저장소 핵심 — h3/Nuxt 를 모른다 (Vitest 로 바로 검사)
│   ├── calendar/             # 구글 캘린더 대조 — 마찬가지로 Nuxt 없이
│   ├── middleware/auth.ts    # /api/* 로그인 필요
│   ├── plugins/              # Nitro 플러그인 (5분 대조 타이머)
│   └── utils/                # Nitro 자동 import (싱글톤·핸들러 래퍼)
├── shared/                   # 서버·화면 공용 — types/, utils/ (`#shared` 별칭)
├── app-ios/                  # Flutter 껍데기 (lib/main.dart, tool/dev-install.sh)
├── scripts/                  # hash-password.mjs
├── _docs/                    # 설계 문서 (reference/product-spec 가 SSOT)
├── _workspace/               # 버리는 실행 산출물 (README.md 만 추적)
└── data/                     # 🔴 로컬 메모 데이터 (gitignore) — 사용자 것, 지우지 않는다
```

## Routing Pattern
- Type: file-based (Nuxt pages)
- Pages location: `app/pages/`
- Dynamic routes: `[id].vue` (`/m/:id`) — id 는 ULID 또는 `p:<인코딩된 경로>`
- Special directories: `pages/**/_modules/**` 는 라우트가 아니다 (`nuxt.config.ts` 의 `ignore`)
- 상태는 주소에 둘 수 있으면 둔다 (예: `/calendar?m=2026-10&d=2026-10-07`)

## Module Organization
- Page logic: `app/pages/<route>/_modules/` (컴포넌트·composable·순수 함수 + 테스트)
- Shared components: `app/components/` (자동 import). `_modules/` 안의 것은 자동 import 가 안 돼 명시적으로 import
- Utilities: `app/utils/`(화면), `shared/utils/`(공용), `server/utils/`(Nitro 자동 import)
- Types: `shared/types/*.ts` — API 모양의 단일 원천 (서버·화면이 같이 씀)
- 서버 도메인 로직은 `server/memo/`, `server/calendar/` 에 두고 h3 에 기대지 않는다. HTTP 변환은 `server/utils/memo.ts` 의 `defineMemoHandler`

## Naming Conventions
- Files: 컴포넌트 PascalCase.vue, composable `useXxx.ts`, 유틸 kebab-case.ts
- Components: PascalCase.vue (페이지 전용은 접두어 — `MemoXxx`, `CalendarXxx`)
- Stores: 없음 (Pinia 미사용) — `useState` 를 쓰는 composable
- Tests: `*.test.ts`, 대상 파일 옆에 둔다
- API 라우트: `<name>.<method>.ts`, 디렉터리 인덱스는 `index.<method>.ts`
