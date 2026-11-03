# Memo #10 로컬 Tauri MVP 인계

- verdict: 핵심 검증 통과 (2026-11-04 macOS 설치·세션 재실행 확인). 추가 native 경계 QA 미검증
- issue: https://github.com/Junjak-Personal/personal-memo/issues/10
- worktree: `/Users/jun/Documents/Codex/2026-11-02/task/personal-memo`
- branch: `feat/tauri-desktop-10`
- HEAD/baseRef: `b8b1334fecc10928296905efb4e1c10f702c1ec1`
- 상태: 미커밋. 원격 쓰기 없음. 다른 세션 폴더의 기존 변경 보존.

설계·실행 명령·검증 근거·남은 UI 흐름은 [진행 기록](../active/processing/2026-11-02-tauri-desktop.md)과 [app-desktop README](../../app-desktop/README.md)에 있다.

됨: 원격 WebView 껍데기, 권한/URL 정책, 연결 안내/취소/뒤로, macOS 패키지, 웹 601개·Rust3개·bootstrap4개·타입/빌드/fmt/clippy, 합성 메모 저장·이동·표/이미지/링크의 실제 파일 대조.

미검증: 최종 로그아웃 쿠키 만료 보완 후 macOS 재실행. 이전 UI 시험에서 로그아웃 뒤 인증 화면 복원 문제가 재현돼 캐시 금지와 명시적 Max-Age=0 삭제를 추가했다. 마지막 응답의 계약/쿠키 만료는 HTTP로 통과했으나 Mac이 잠겨 native 결과를 확인하지 못했다. 원인을 캐시 하나로 확정하지 않는다.

재개: Mac을 사람이 잠금 해제한 뒤 진행 기록의 서버 명령을 **기존 .env.test 그대로** 실행한다. 세션 키를 재생성하면 실패 재현을 가릴 수 있다. 다음으로 로그인/정상 세션 유지/로그아웃/미제출 입력/종료/재실행을 확인한다. 실제 운영 계정/서버는 사용하지 않는다.

종료 상태: 이번 작업의 localhost:4710 서버, :4711 프록시, 테스트 앱은 경로 확인 후 SIGTERM으로 종료했다. Mac 잠금은 변경하지 않았다. 자동 승인 거절·대기 없음. 설치/원격 게시/배포/실제 데이터 변경은 금지 범위를 유지한다.


## 2026-11-04 후속 — 사용자 승인에 따른 정식 빌드 설치·main 반영

- 사용자 「메인에 반영」「prd 빌드로 설치」 승인으로 정식 빌드를 `/Applications/Memo.app`에 설치했다. `win.jundevlog.memo.desktop` / 0.1.0, 고정 주소 `https://memo.jun-devlog.win/`. 서명 및 빌드/설치 실행 파일 동일성 확인, 실제 실행·개인 서버 연결 확인. 실제 메모 수정 없음.
- 현재 소스로 웹601·Rust3·초기화4·타입검사·웹 빌드·fmt·clippy·정식/로컬 macOS 패키징 통과. 근거는 `_workspace/desktop-10/prd-install-20261104/` 및 `desktop-{check,prd}-current*.log`.
- 기존 `.env.test`와 시험 세션 키를 유지한 로컬 앱에서 재실행 후 로그인 유지, 로그아웃→미제출 시험 입력→종료(기존 PID 종료 확인)→재실행→빈 로그인 화면·인증 화면 미복원 확인. `native-restart-result.json`에 핵심 결과 기록. 이전 Mac 잠금에 따른 세션 QA 차단은 해소됐다.
- 현재 판정: 자동 검사·macOS 설치·핵심 세션 검증 통과. 외부 링크 OS 브라우저 열기·다운로드/권한 거절·서버 중단 복구의 추가 native QA, Windows/Linux 실행은 미검증. 사용자가 추가 테스트를 멈추고 main 반영을 마무리하도록 지시해 더 넓은 QA는 진행하지 않는다.
- 정식 앱은 개인 vault 접속용이며 App Store 출시 계획은 없다. 설치는 로컬 ad-hoc 서명이며 공증 배포나 스토어 출시가 아니다.
