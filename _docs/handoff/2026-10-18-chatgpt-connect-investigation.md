# ChatGPT 연결 조사 — 인계 (2026-10-18)

이어받는 세션용. 브랜치 `fix/chatgpt-connect-logging`, 이 문서와 같은 PR.

## 목표

개인 일상용으로 ChatGPT(데스크탑·앱)에서 memo MCP 를 쓰는 것. Claude 는 업무·개발용으로 이미 연결돼 잘 된다.

## 증상

- ChatGPT(Pro 요금제)에 「Memo」 플러그인은 등록돼 있다. 할 일을 물으면:
  「현재 @Memo 플러그인의 할 일 조회 기능에 접근할 수 없어 목록을 가져오지 못했습니다 … 플러그인 도구가 현재 대화에 노출되지 않은 상태일 수 있습니다」
- 운영 서버 `data/oauth/grants.json` 에 ChatGPT 연결이 **한 번도 없다** (claude.ai·Claude Code 만). → 토큰 발급 전 어딘가에서 멈춤.

## 확인한 것 (정상)

| 항목 | 결과 |
|---|---|
| 서버 → `https://chatgpt.com/oauth/client.json` | 200, redirect_uris = `https://chatgpt.com/connector_platform_oauth_redirect` (같은 출처라 거절 안 됨) |
| 인증 서버 메타데이터 | OpenAI 요구 항목 다 있음: CIMD, `authorization_response_iss_parameter_supported`, S256, `none` |
| 운영 `/oauth/authorize` 에 ChatGPT 와 같은 요청 | resource 가 서버 주소·`/mcp`·없음 모두 302 → 승인 화면 |
| 찾기 문서·/mcp (여러 UA, 맥에서) | 200·401 정상. **`Python-urllib/3.12` 만 Cloudflare 403 error 1010** |

OpenAI 문서: https://developers.openai.com/plugins/build/auth — 우리 서버는 iss 를 지원하므로 ChatGPT 는 고정 신원 문서(`chatgpt.com/oauth/client.json`)를 쓴다.

## 이 PR 이 고치는 것

1. **`/.well-known/openid-configuration` 이 SPA HTML 을 200 으로 주던 것 → 404.** `/.well-known/` 아래 모르는 주소는 전부 404
   (`server/middleware/oauth-discovery.ts`). OIDC 찾기를 먼저 보는 클라이언트는 그 HTML 을 인증 서버 문서로 읽다 실패한다. ChatGPT 가
   그 순서인지는 미확인 — 원인 후보 1.
2. **단계별 로그** `[oauth] …` (`server/utils/oauth.ts` 의 `oauthLog`) — 찾기 문서, 승인 요청(거절 이유), 토큰(발급/오류 코드), `/mcp` 401·403,
   연결 직후 `initialize`·`tools/list`. 줄마다 `ua=` 와 Cloudflare `ray=`. 토큰·승인 코드·PKCE 값·쿠키는 적지 않는다.

검증: Vitest 211, typecheck, 격리 빌드에서 ChatGPT 흉내 흐름 5/5, `openid-configuration` 404, 로그에 비밀값 없음.

## 다음 단계

1. 이 PR 머지 → main push 로 자동 배포 (GitHub Actions, self-hosted n100). 머지는 사용자 지시가 있을 때만.
2. 사용자가 ChatGPT **웹**에서 Memo 를 지우고 다시 만든다 — 주소 `https://memo.jun-devlog.win/mcp`, 인증 **OAuth**.
3. 운영 로그를 본다:
   `ssh junserver-ext 'docker logs --since 30m personal-memo 2>&1 | grep -E "^\[(oauth|mcp)\]"'`
   - 클라우드 세션에는 이 SSH 가 없다 → 사용자에게 로컬에서 `! <위 명령>` 으로 돌려 결과를 붙여 달라고 한다.
   - 배포하면 컨테이너가 새로 떠서 이전 로그는 사라진다 — 반드시 배포 **뒤에** 시도.
4. 판정
   - ChatGPT 요청이 한 줄도 없음 → **Cloudflare 차단**. 사용자 대시보드: Security → Events (memo.jun-devlog.win). 해결은 `/mcp`·`/oauth/*`·
     `/.well-known/*` 의 봇 검사 건너뛰기(WAF skip). 무료 요금제 Bot Fight Mode 는 경로별로 못 꺼서 통째로 꺼야 할 수 있다.
   - `승인 요청 거절 … : <이유>` → 이유대로 (돌아갈 주소면 로그에 신원 문서의 목록이 같이 찍힌다)
   - `토큰 … → <오류>` → 토큰 끝점 (`server/routes/oauth/token.post.ts`, `server/oauth/grants.ts`)
   - `MCP initialize` 까지 왔는데 도구가 안 보임 → MCP 응답 쪽 (`server/routes/mcp.ts`, `server/mcp/tools.ts`)

## 남는 한계

여러 안내 글에 따르면 ChatGPT 개발자 모드의 사용자 연결은 **웹에서만** 쓰고 iOS·안드로이드 앱에서는 안 된다 (데스크탑은 글마다 다름,
Plus·Pro 는 아예 못 만든다는 글도 있음). OpenAI 공식 도움말(help.openai.com/en/articles/12584461)은 자동 접근이 막혀 확인 못 했다.
연결이 돼도 폰 앱에서 쓸 수 있는지는 사용자가 직접 확인해야 한다.

## 다른 에이전트 의견 (사용자가 전달)

- Cloudflare 1010 — 위 표처럼 `Python-urllib` UA 로 재현. 실제 OpenAI IP 에서도 걸리는지는 로그·Cloudflare 이벤트로 확인.
- 다른 도메인 콜백 거절 — 지금 ChatGPT 신원 문서는 같은 도메인이라 해당 없어 보임. 다른 주소가 오면 새 로그에 찍힌다.
