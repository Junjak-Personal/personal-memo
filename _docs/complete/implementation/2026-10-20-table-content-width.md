# 모바일·PC 표를 실제 내용 폭에 맞추기

- status: complete
- verdict: fixed
- baseRef: fb2be596dbf27c9b69755268615ff06e947ba989
- branch: codex/table-content-width
- 요청: 모바일 표가 압축되어 읽기 어렵다. PC도 같은 원칙. 자동 개행은 하지 않고 사용자가 직접 개행한다. 후속 확정은 최소 폭/여유 폭 대신 내용에 딱 맞추기.

## 최종 변경

`app/app.config.ts`의 공통 UEditor 표 CSS만 변경한다. `width:100%` 대신 `width:max-content`, `table-layout:auto`를 사용해 브라우저가 실제 글꼴·서식과 셀별 가장 긴 줄로 열 너비를 구한다. th/td에는 white-space:pre와 word-break:normal을 적용해 자동 줄바꿈 없이 직접 넣은 br/문단/텍스트 개행을 유지한다. 표 안 코드 블록에도 자동 개행을 적용하지 않는다. 기존 셀 안쪽 여백(좌우16px)은 유지한다.

짧은 표는 문서 폭까지 늘리지 않으며 긴 표는 기존 tableWrapper 안에서만 가로 스크롤한다. 모바일/PC, GFM/HTML/병합 표에 같은 규칙이다. 저장·schema·span·자동저장·표 편집/undo 로직은 변경하지 않는다. 글자 수 추정 계산과 그 최소 폭 decoration은 최종 변경에 포함하지 않는다.

## 검증

- 최종 Vitest 전체 33파일333개 통과, Nuxt typecheck exit0, Nuxt build exit0(10.5초), git diff --check 통과. 표시 CSS 변경이라 구현을 그대로 반복하는 별도 단위 검사는 추가하지 않았다.

- 로컬 localhost:4721, 캘린더 OFF인 기존 격리 dotenv/합성 데이터 사용. 운영 「고정비용」 원문 조회·수정 없음.
- 실제 Chrome Nuxt 화면의 PC 및 390×844 모바일에서 6열 합성 비용 표·짧은 병합 표·직접 넣은 두 문단/br 개행을 확인했다. 모바일 표를 가로로 끌어 마지막 비고 열까지 확인했고 제목/다음 표/상단 도구가 같이 움직이지 않음을 확인했다.
- 긴 설명은 한 줄, 수동 개행은 두 줄, 짧은 표는 실제 내용 폭으로 표시. 비고 마지막 글자 뒤에는 기존 셀 padding만 남는다.
- 증거: `_workspace/e2e/2026-10-20-table-width/mobile-intrinsic.png`, `mobile-right.png`, `desktop-intrinsic.png`, `tests-final.log`, `typecheck-final.log`, `build.log`.
- iPhone Safari/Flutter WKWebView 실기기 화면은 미검증. CSS 표 레이아웃 변경이며 네이티브 변경 없음.
- 새 의존성·권한·자격 증명 변경 없음. 원본 checkout과 기존 미추적 2개 경로 보존. 기존 완료 후 배포 승인에 따라 최종 검사 후 정상 Actions 경로로 배포한다.
