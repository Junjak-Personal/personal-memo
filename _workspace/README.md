# _workspace/ — throwaway run output

Gitignored except this file. Everything here is disposable; delete freely.
**Before writing here, read this file** — it says which context folder a file belongs in.
**After adding a new context folder, add a row here** so the next session reuses it.

| Folder | What goes in it |
|--------|-----------------|
| `e2e/` | Playwright/E2E run output — `<YYYY-MM-DD>-<test-name>/{screenshots,artifacts,report}/`, run.log |
| `issues/2026-10-21/` | 추천 기능 #3~#7 이슈 본문·생성 결과, 최근/즐겨찾기·수정 이력 자동 검사와 격리 HTTP 스모크 근거 |
| `issues/2026-10-21-remaining/` | #3/#4 기존 미커밋 기준 해시/patch, #5→#6→#7 순차 구현·회귀·통합 API 근거 |
| `e2e/2026-10-20-refactor/` | 책임 분리 기준/최종 검사 로그·기존 native 파일 해시·합성 데이터 UI 증거 |
| `e2e/2026-10-20-startup-loading/` | 첫 실행 스플래시·tree 요청 공유 검증 로그/Chrome 증거, 기존 격리 dotenv 재사용 |
| `e2e/2026-10-22-todo-priority/` | 할 일 날짜·중요도 정렬, 할 일 ⇔ 「할 일」 폴더 스모크 스크린샷 (격리 데이터) |
| `desktop-10/` | Memo #10 로컬 Rust 도구·합성 데이터·HTTP/빌드/회귀 검사 근거 |
| `desktop-local/` | app-desktop/tool/local-server.mjs의 격리 시험 서버 데이터·임시 dotenv |
| `spike/` | 0단계 스파이크 실행 기록 (S1 로그 등) |
| `ui/` | 화면 확인 스크린샷 — `NN-<화면>-<폭>[-dark].png` |

Rules: one folder per purpose, named for that purpose. A bare file at `_workspace/` root
or at the repo root is a defect. Vendor state paths win (Playwright auth → `playwright/.auth/`).
