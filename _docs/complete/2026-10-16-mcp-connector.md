---
status: complete
verification: VERIFIED (격리 빌드) / 운영 연결은 배포 뒤
---

# MCP 커넥터 — AI 가 메모를 직접 읽고 쓰기 (2026-10-16)

## 사용자 결정 (2026-10-16)

- 쓸 곳: 맥의 Claude Code·Desktop 과 **폰·웹 claude.ai** 까지 → OAuth 필요
- 권한: 읽기 + 쓰기. **영구 삭제는 막는다** (휴지통으로 보내기까지만)
- 고치기: **읽은 버전으로만** — 화면과 같은 충돌 규칙

## 구조

앱 서버(Nitro) 안에 MCP 엔드포인트와 OAuth 인증 서버를 같이 둔다. 파일을 직접 만지지 않고 `MemoStore` 를 거친다 —
id·frontmatter·충돌 판정·구글 캘린더 반영·휴지통이 화면과 똑같이 지켜진다.

| 경로 | 역할 |
|---|---|
| `POST /mcp` | MCP (Streamable HTTP, 세션 없음, JSON 응답). `@modelcontextprotocol/sdk` 1.32.x |
| `GET /.well-known/oauth-protected-resource[/mcp]` | 보호 자원 메타데이터 (RFC 9728) — `resource: https://memo.jun-devlog.win/mcp` |
| `GET /.well-known/oauth-authorization-server` | 인증 서버 메타데이터 (RFC 8414) — CIMD 광고, PKCE S256, `token_endpoint_auth_methods: ["none"]`, `iss` 응답 |
| `GET /oauth/authorize` | 앱에 로그인돼 있지 않으면 로그인 화면 → 승인 화면(「Claude 가 메모를 읽고 쓰려 합니다」 허용/거부) |
| `POST /oauth/token` | 코드 교환(PKCE) · 갱신 토큰(회전) |

- 클라이언트 등록: **Client ID Metadata Document 만** (MCP 2026-07-28 규격 권장, DCR 은 폐기 예정). `client_id` URL 을 받아 문서를
  읽고 `redirect_uri` 를 문서의 목록과 맞춘다(루프백은 포트 무시). **허용 목록: `https://claude.ai/` 에 있는 신원 문서만** —
  claude.ai(웹·폰·Desktop)와 Claude Code(`https://claude.ai/oauth/claude-code-client-metadata`). 다른 앱은 승인 화면까지도 못 온다.
- 승인은 앱 비밀번호로 로그인한 사람만. 승인 화면에 돌아갈 주소의 호스트를 크게 보여 준다.
- 토큰: 접근 토큰 1시간(서명된 토큰, aud = MCP 주소 검사), 갱신 토큰 60일·쓸 때마다 회전. 서버에는 해시만 `data/oauth/` 에
  남긴다(메모 백업 대상 밖). 배포로 서버가 다시 떠도 연결이 유지된다.
- 「모든 AI 연결 끊기」: 갱신 토큰 전부 폐기 + 서명 키 교체 — 화면 한 곳(할 일 화면처럼 단순한 설정 화면)에서.
- 401 에는 `WWW-Authenticate: Bearer resource_metadata=…` — claude.ai 가 이걸 보고 로그인을 시작한다.

## 도구 (scope 하나: `memo`)

| 도구 | 하는 일 | 비고 |
|---|---|---|
| `list_memos` | 폴더 트리 + 메모 목록(제목·폴더·날짜·태그·할 일) | 읽기 |
| `search_memos` | 제목·본문 검색, `#태그` 거르기 | 읽기 |
| `read_memo` | 본문 + 메타 + `version` | 읽기 |
| `list_todos` | 안 끝난 할 일 (끝난 것 포함 선택) | 읽기 |
| `calendar` | 기간 안의 일정·만든 메모 | 읽기 |
| `create_memo` | 폴더·제목·본문·날짜·태그, 할 일로 만들기 | 쓰기 |
| `update_memo` | `version` 필수. 준 필드만 바꾼다(제목·본문·날짜·태그). 그 사이 바뀌었으면 거절 → 다시 읽고 고치게 안내 | 쓰기 |
| `set_todo` | 할 일 체크/풀기/해제 | 쓰기 |
| `move_memo` | 다른 폴더로 | 쓰기 |
| `create_folder` | 폴더 만들기 | 쓰기 |
| `trash_memo` | 휴지통으로 (30일 안에 되살릴 수 있음) | 쓰기·destructive 표시 |

없는 것: 휴지통 비우기, 폴더 지우기, 이미지 올리기(본문에 기존 이미지 링크는 그대로 둔다).
쓰기 도구는 서버 로그에 `[mcp] update_memo <id> (claude.ai)` 처럼 남긴다.

## 위험과 대응

- **토큰이 새면 메모 전체를 읽고 쓸 수 있다** → 토큰 수명 짧게, 갱신 토큰 회전·해시 저장, 「모든 연결 끊기」, 허용 클라이언트 고정.
- **프롬프트 주입**: 메모 본문(공유 시트로 받은 웹 글 등)에 AI 를 향한 지시가 섞일 수 있다. Claude 의 보호 + 영구 삭제 없음 +
  휴지통 30일 + 매일 백업으로 피해를 되돌릴 수 있게 둔다.
- 편집 중인 메모를 AI 가 고치면 화면은 「다른 곳에서 먼저 수정했습니다」를 띄운다(지금 규칙 그대로) — 덮어쓰지 않는다.

## 확인 계획

- 단위: PKCE·리다이렉트 매칭·CIMD 검증·토큰 회전·만료·aud, 도구별(임시 폴더의 MemoStore), version 불일치 거절.
- 격리 빌드에서 OAuth 전체 흐름을 스크립트로(가짜 CIMD 는 시험용 허용 목록으로만), MCP Inspector 또는 curl 로 도구 호출.
- 배포 뒤: Claude Code 로 연결(`claude mcp add --transport http memo https://memo.jun-devlog.win/mcp`) → claude.ai 커스텀 커넥터 →
  폰 Claude 앱에서 메모 읽기·만들기.

## 구현과 확인 (2026-10-16)

- 코드: `server/oauth/{client,grants}.ts`(Nuxt 없이 검사), `server/mcp/tools.ts`, `server/routes/{mcp.ts, oauth/authorize.get.ts,
  oauth/token.post.ts}`, `server/middleware/oauth-discovery.ts`(`.well-known` 은 점으로 시작해 routes 가 줍지 않는다),
  `server/api/oauth/{requests,connections}`, 화면 `app/pages/oauth/consent.vue`·`app/pages/ai/`, 사이드바 「AI 연결」.
- 설정: `runtimeConfig.mcp.clientOrigins`(기본 `https://claude.ai`) — `runtimeConfig.oauth` 는 nuxt-auth-utils 자리라 피했다.
- 단위: OAuth 13개(허용 출처·신원 문서 검증·리다이렉트 매칭·PKCE RFC 7636 예시·코드 1회/1분·회전·도난 감지·끊기·재시작 뒤 유지·
  파일 600), MCP 도구 7개(목록·영구 삭제 없음·옛 version 거절·할 일·검색·캘린더·옮기기·휴지통), safeNext 2개. 전체 172개.
- 격리 빌드 e2e 23/23 (시험용 신원 문서를 127.0.0.1:4798 에서, 그 출처만 허용): 401+resource_metadata, 찾기 문서, 허용 안 된
  클라이언트·문서에 없는 돌아갈 주소는 400 화면(돌려보내지 않음), PKCE 아니면 invalid_request, 로그인 없이 승인 401, 허용 →
  code·state·iss, 틀린 verifier·같은 코드 두 번 invalid_grant, SDK 클라이언트로 도구 호출(파일까지 확인), 갱신 회전, 도난 감지 →
  그 연결 토큰 401.
- 🔴 e2e 에서 잡은 결함: 만료·끊긴 토큰의 401 헤더에 한국어 설명 → Node 가 헤더를 거부해 500. ASCII 로 고쳤다.
- 브라우저: 로그아웃 상태로 /oauth/authorize → 로그인(`?next=`) → 승인 화면 → 허용 → 클라이언트의 돌아갈 주소로. 「AI 연결」 화면에서
  연결 목록·끊기 → 그 토큰 401. PC·폰 폭.
- 남은 것: 운영 배포 뒤 claude.ai(웹·폰)·Claude Code 로 실제 연결. Cloudflare 보안 설정이 Anthropic 서버(160.79.104.0/21)의 요청을
  막지 않는지는 그때 확인한다.
