# Desktop (Tauri MVP #10)

- 독립 경계: `app-desktop/` (pnpm/Cargo 잠금 파일 별도). Nuxt/Vue 원격 웹뷰, 서버 API/쿠키/저장소 재사용. iOS는 그대로.
- 명령: `pnpm --dir app-desktop dev`, `build:local`, `build`, `test`, `check`.
- 시작: 연결 안내 버튼 없이 허용된 메모 서버를 바로 연다. 세션·인증은 기존 웹을 사용하고 연결 안내는 메뉴의 수동 복구 경로로 남긴다(2026-11-17).
- 환경: 정식은 고정 HTTPS, debug/local-test는 loopback만. 개발 주소 `MEMO_DESKTOP_DEV_URL`은 컴파일 시 반영. localhost 기본 4710, 별도 앱 식별자로 빌드한다.
- 전역 Rust 설정을 바꾸지 않았다. 이번 실행은 worktree `_workspace/desktop-10/rust/{rustup,cargo}`를 RUSTUP_HOME/CARGO_HOME으로 사용했다.
- API no-store와 `/api/_auth/session` DELETE의 명시적 쿠키 만료는 데스크톱 세션 QA 중 추가했다. 계약·기존 훅은 유지한다. 운영에 배포하지 않았다.
- 2026-11-04 정식 빌드를 `/Applications/Memo.app`에 설치·실행했다. 기존 시험 세션을 유지한 native 로그아웃→미제출 입력→종료/재실행에서 로그인 화면 확인. 이전 Mac 잠금 차단 해소. 외부 링크/다운로드 거절/서버 복구의 추가 native QA와 다른 OS는 미검증. App Store 출시 계획 없음.
- 상세: [README](../../app-desktop/README.md), [진행 기록](../../_docs/active/processing/2026-11-02-tauri-desktop.md), [인계](../../_docs/handoff/2026-11-02-tauri-desktop-10.md).

- 2026-11-17 시작 연결 안내를 제거한 정식 macOS 빌드를 `/Applications/Memo.app`에 교체했다. 서명 검증·빌드/설치 실행 파일 SHA-256 일치, 이전 PID 종료·새 PID 실행, 연결/로그인 버튼 없이 기존 인증 세션으로 메모 목록 표시를 실제 확인했다. 운영 본문/설정 변경 없음. 근거: `_workspace/desktop-startup-2026-11-17/verified-install.json`.
- 이번 재빌드의 Rust 1.99.1은 `_workspace/desktop-startup-2026-11-17/rustup`에 격리했다. 이전 Documents 작업 폴더의 툴체인은 compiler dylib가 빠져 fmt/clippy가 실행되지 않았다. 전역 Rust는 변경하지 않았다.
