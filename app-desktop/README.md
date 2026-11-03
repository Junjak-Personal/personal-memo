# Memo desktop — Tauri MVP (#10)

기존 Nuxt/Vue 웹을 같은 출처의 Tauri WebView로 연다. 편집기·Markdown·이미지·파일 저장소·API는 기존 웹을 사용한다. 번들 프런트엔드는 연결 안내 화면뿐이다. 오프라인 동기화·업데이트·배포·설치는 포함하지 않는다.

## 실행과 빌드

macOS Apple Silicon에서 Node 24, pnpm 12.6.0, Rust 1.99.1 stable, Xcode로 빌드했다. 기존 시스템 Rust 1.70은 사용할 수 없다. 코드상 Windows/Linux 분기는 있지만 패키징·실행을 검증하지 않았다. macOS 최소 설정은 12.0이며 12.0 기기 검증은 하지 않았다.

```sh
# repo root: 잠금 파일 유지
pnpm install --frozen-lockfile
pnpm --dir app-desktop install --frozen-lockfile

# 실제 사용자 data/ 대신 비어 있는 _workspace/desktop-local/data 사용.
# 이 서버에서만 쓸 임시 비밀번호를 환경변수로 지정한 터미널에서 실행한다.
node app-desktop/tool/local-server.mjs

# 다른 터미널 — 기본 http://localhost:4710, 별도 앱 식별자
pnpm --dir app-desktop dev
# 배포 형식의 로컬 테스트 .app (localhost만 허용)
pnpm --dir app-desktop build:local

# 정식 원격 HTTPS 서버를 여는 .app. 빌드만 하며 설치·실행·배포하지 않는다.
pnpm --dir app-desktop build
```

`MEMO_DESKTOP_TEST_PASSWORD`는 서버 시작에만 필요하며 출력하거나 앱에 저장하지 않는다. 시험 서버는 캘린더를 끄고 127.0.0.1에만 바인딩한다. 서버를 다시 시작하면 시험 세션 키가 바뀐다. 포트 4710을 다른 세션이 쓰면 그 서버를 종료하지 말고 별도 포트를 지정한 개발 서버와 `MEMO_DESKTOP_DEV_URL=http://localhost:<포트>/`를 사용한다. 개발 주소는 **빌드 시점**에 반영된다. `/path`·쿼리·사용자 정보·외부 호스트는 거절한다.

산출물은 `src-tauri/target/release/bundle/macos/Memo.app`와 `Memo Local Test.app`. 폴더에서 직접 실행할 수 있다. macOS 번들은 로컬 ad-hoc 서명만 사용하며 인증서·공증·배포 설정은 없다. DMG·자동 업데이트·Applications 설치를 하지 않는다.

이번 작업에 내려받은 Rust는 전역 설정을 바꾸지 않고 다음 환경변수로 선택했다(repo root 기준). 작업 환경에서 실행하려면 pnpm/cargo 명령 전 같은 값을 지정한다.

```sh
export RUSTUP_HOME="$PWD/_workspace/desktop-10/rust/rustup"
export CARGO_HOME="$PWD/_workspace/desktop-10/rust/cargo"
```

## 사용

1. 연결 안내에서 「메모 열기」 → 기존 비밀번호 로그인 → 기존 폴더/검색/편집/자동저장.
2. 메뉴 「이동 → 뒤로」는 ⌘[ / Ctrl+[. 기존 웹의 저장·라우팅 가드를 사용한다.
3. 연결 실패 시 「이동 → 연결 화면…」(⌘⇧L / Ctrl+Shift+L). 확인창에서 취소하면 현재 화면을 유지한다. 서버가 돌아온 뒤 다시 연다.
4. 웹뷰 저장소에 기존 세션 쿠키·초안이 남으므로 로그인은 앱/브라우저별로 한다. 앱 재실행 시 연결 안내를 거친다. 실제 인증 여부는 서버가 정한다.

## 인증·권한과 경계

- 정식 빌드는 `https://memo.jun-devlog.win/` 고정. 런타임 환경변수로 서버를 바꾸지 않는다. debug/local-test는 loopback만 허용하고 문서의 스크립트는 별도 식별자를 쓴다.
- HTTP API는 동일 출처의 기존 쿠키 인증이다. 비밀번호·토큰을 Rust/설정/별도 키체인에 복사하지 않는다. 브라우저 쿠키를 가져오지 않는다.
- capability 목록은 비어 있고 원격 IPC 권한도 없다. 전역 Tauri API·fs/shell/http 플러그인을 열지 않는다. Dialog 플러그인은 Rust 메뉴에서만 사용한다.
- 초기화 스크립트는 연결 안내의 주소를 설정하고, 허용 출처의 `/api/` fetch에만 `cache: no-store`를 적용한다. 외부 요청·정적 자원·본문·쿠키·signal/headers/credentials 옵션은 그대로 둔다.
- 서버의 API 응답에도 no-store를 설정한다(이미지 라우트의 명시적 private immutable 캐시는 유지). 로그아웃은 기존 훅을 실행한 뒤 세션 쿠키를 Max-Age=0으로 삭제한다. 이 서버 변경은 운영에 배포하지 않았다.
- 같은 출처의 새 창은 기존 창으로, 외부 http/https/mailto는 OS 기본 브라우저로 보낸다. file/data/javascript/blob/기타 앱 스킴의 최상위 탐색·다운로드·웹 권한 요청은 거절한다. 외부 링크 연속 열기는 800ms 제한이다.
- 서버가 제공하는 원격 코드의 무결성·가용성은 기존 HTTPS 서버에 의존한다. 서버 파일·실제 계정은 이 작업에서 변경하지 않았다.

## 검사

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm --dir app-desktop test
pnpm --dir app-desktop check
```

웹 린터 설정은 없다. Rust는 fmt/clippy를 사용한다. 검증 결과·미검증 흐름·Mac 잠금 차단은 [구현 기록](../_docs/active/processing/2026-11-02-tauri-desktop.md)에 둔다. 실제 사용자 계정, 운영 연결, 다른 OS, iOS 실행은 검증하지 않았다.
