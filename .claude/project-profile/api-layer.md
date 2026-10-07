# API Layer

## Client
- Type: 수동 — Nitro 파일 라우트 + 공용 타입. 생성기 없음
- Base client: `$fetch` (동작), `useFetch` / `useAsyncData` (화면 데이터)
- Base URL config: 같은 출처 (`/api/...`). 서버 바깥 주소는 `NUXT_SITE_URL` (구글 일정 설명용)

## Contract (SSOT)
- `shared/types/memo.ts`, `shared/types/calendar-sync.ts` — 서버·화면이 같은 타입을 import
- 파일 frontmatter 는 snake_case(`date_end`), API 는 camelCase(`dateEnd`) — 변환은 서버 저장소가 한다
- API 목록: 설계문서 `_docs/reference/product-spec/2026-10-06-product-spec.md` §6
- Generated Code: 없음 (regen 명령·spec source N/A)

## Request Patterns
```ts
// 화면 데이터 — 반응형 query 면 바뀔 때 다시 가져온다
const { data } = await useFetch<CalendarResponse>('/api/calendar', { query: range })
// 열 때마다 새로 받아야 하는 것
await useAsyncData(key, () => $fetch<Memo>(`/api/memos/${encodeURIComponent(id)}`), { getCachedData: () => undefined })
// 서버 핸들러 — 저장소 오류(MemoError)를 HTTP 로 바꾸는 래퍼
export default defineMemoHandler(async (event, store) => store.update(memoIdParam(event), parseUpdateInput(await readBody(event))))
```
- 저장 경로가 캘린더에 영향을 주면 `useCalendarSync()?.notify(memo)` 를 부른다 (설정이 없으면 null)
- id 는 path param 으로 넣을 때 `encodeURIComponent` (`p:` 경로 id 에 `/` 가 있다)

## Auth
- Token storage: nuxt-auth-utils 봉인 쿠키 `memo-session` (httpOnly, 30일 절대 만료, `secure` 는 운영만)
- 서버: `server/middleware/auth.ts` — `/api/*` 전부 로그인 필요. 예외 `/api/auth/login`, `/api/health`, `/api/_auth/*`, `/api/_nuxt_icon/*`
- 화면: `app/middleware/auth.global.ts`
- 로그인 잠금: 5회 실패 → 15분 (`server/utils/login-guard.ts`, 메모리)
- Refresh: 없음 (세션 쿠키)

## Error Handling
- 서버: 도메인은 `MemoError(code)` 를 던진다 (`server/memo/errors.ts`, code → status). `defineMemoHandler` 가 `createError({ data: { code, message, ...extra } })` 로 바꾼다
  — 🔴 statusMessage 는 ASCII 만 실리므로 한국어 문구는 `data.message`
- 409 충돌은 `data.version` (현재 해시)을 실어 화면이 「다시 불러오기 / 덮어쓰기」를 고른다
- 버전 해시는 frontmatter `done:` 줄을 빼고 잰다 — 할 일 체크는 `PATCH /api/memos/:id/done` 로만 바꾸고 `PUT` 은 파일의 값을 둔다 (설계문서 §3.5)
- 화면: `apiMessage(e, '대체 문구')`, `apiStatus(e)`, `apiData(e)` (`app/utils/api-error.ts`) → 토스트·UAlert
- 조용히 실패하지 않는다 — 실패는 화면에 이유와 다시 시도 수단을 둔다

## 외부 API — 구글 캘린더
- `server/calendar/google.ts`: 서비스 계정 JWT → 토큰(캐시, 만료 1분 전 갱신) → events list/insert/patch/delete
- 설정: `NUXT_GOOGLE_CALENDAR_ID` + (`NUXT_GOOGLE_SERVICE_ACCOUNT` base64 | `NUXT_GOOGLE_SERVICE_ACCOUNT_FILE`). 없으면 꺼짐
- 🔴 개발에서 운영 캘린더를 켜지 않는다 — 대조가 모르는 memoId 일정을 지운다
