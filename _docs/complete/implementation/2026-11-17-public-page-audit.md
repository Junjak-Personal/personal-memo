---
title: 외부 공개 페이지 점검과 읽기 접근성 보완
status: complete
topic: public-page-audit
kind: implementation
scope: frontend
created: 2026-11-17
updated: 2026-11-17
owner: jhyoon
related:
  - _docs/reference/product-spec/2026-10-06-product-spec.md
---
# 외부 공개 페이지 점검

- 사용자 요청: 편집기 배포 후 외부 노출용 페이지도 점검한다. 기존 커밋·푸시·배포 승인에 이어 관련 결함을 보완한다.
- 기준: `ef10570e0fcf92b387d9362a6f4e78cc81292f22`, main, 시작 2026-11-17 KST.
- 운영은 익명 읽기만 수행한다. 실제 공개 설정·본문·원본 이미지는 수정하지 않는다. 합성 검증 서버는 127.0.0.1:4742, 임시 데이터, Google Calendar OFF다.
- 공개 메모·폴더·목록·이미지·링크·접근 제한과 desktop/mobile/keyboard/error/retry를 점검한다. 새 의존성·API 계약·디자인 재구성은 없다.

## 재현과 구현 범위

| 재현 | 영향 | 담당/범위 | 완료 조건 |
|---|---|---|---|
| 공개 페이지 viewport 확대 제한 + gesturestart preventDefault | 외부 독자가 문서를 확대해서 읽기 어려움 | public_zoom: ext.vue, no-pinch-zoom.client.ts | 공개에서 확대 허용, 로그인/편집 앱 기존 제한 보존 |
| 읽기 본문 role=textbox, 체크박스 disabled=false이며 클릭 후 되돌아감 | 입력 가능한 폼처럼 보이고 들림 | root: ExtMemo.vue | 문서 의미, 읽기 전용 체크 상태·선택·링크 보존 |
| 공개 API 조회에 timeout 없음 | 응답이 멎으면 로딩·재시도 전환 없음 | public_zoom: 목록, root: 본문/폴더/백링크 | 기존 오류·재시도와 15초 제한 결합 |

## 검증

1. 운영 공개 화면의 링크·목록·모바일 메뉴, 레이아웃을 익명 확인한다.
2. 합성 공개/비공개/빈 폴더로 이미지·표·컬럼·체크·링크·백링크와 같은 404 경계를 확인한다.
3. 브라우저 네트워크 차단 후 공개 목록·본문·폴더 오류와 재시도를 확인한다.
4. 관련 공개 경계 단위 검사, 전체 단위·타입·빌드를 확인하고 main workflow로 운영 배포, revision·health·외부 asset을 대조한다.


## 점검과 보완 결과

| 중요도 | 확인한 문제 | 원인과 보완 | 결과 |
|---|---|---|---|
| P1 | 공개 문서 확대 제한 | 앱 전역 viewport·iOS gesture 방지가 공개 레이아웃에도 적용됨. 공개 viewport만 확대 허용하고 route.meta.layout으로 제스처 방지를 구분 | 수정·브라우저 확인 |
| P2 | 공개 본문을 입력칸으로 노출 | UEditor의 기본 role=textbox를 읽기 전용 문서 의미로 변경 | 수정·브라우저 확인 |
| P2 | 체크박스가 클릭 후 되돌아가고 비공개 링크가 활성 링크처럼 보임 | 공개 체크는 disabled로 상태만 표시, 차단된 링크는 회색·밑줄 제거. 원문과 체크 상태는 유지 | 수정·브라우저 확인 |
| P2 | 공개 조회의 명시적 대기 제한 없음 | 목록·본문·폴더·백링크 $fetch에 요청당 15초 timeout. 기존 오류·재시도를 재사용 | 수정·타입/빌드 및 차단·복구 smoke |

- 접근 경계: 공개 DTO 최소 필드, 비공개/없는 ID의 같은 404, 개인 API 401, 본문 미참조 이미지·경로 탈출 차단을 확인했다. 폴더 공개 해제 뒤 본문·이미지 404와 빈 공개 tree를 확인했다. 실 vault는 변경하지 않았다.
- 정상 표시: 이미지 로드·대체 텍스트·320×320 표시, 2열/좁은 화면 세로 배치, GFM 넓은 표의 내부 스크롤, HTML colspan/rowspan 표, 코드, 체크 상태·첫 줄 정렬이 유지된다. 390px에서 본문 가로 넘침 없음.
- 탐색: 키보드 Enter로 메모 이동, 공개 백링크 이동, 빈 폴더, 검색 결과 선택·입력 초기화, 모바일 공개 목록 이동·닫기 버튼을 확인했다.
- 실패: 실제 브라우저 Network.setBlockedURLs로 본문/목록·폴더 요청을 막아 오류·재시도 버튼을 확인한 뒤 차단을 풀어 복구했다. 공개되지 않은 메모와 없는 메모는 같은 안내와 재시도 없는 404 상태다.
- 확대 회귀: 공개→로그인→공개를 같은 SPA에서 이동해 viewport 메타가 하나만 남고, 공개에서는 gesturestart가 취소되지 않으며 로그인에서는 기존처럼 취소되는 것을 확인했다. 실제 손가락 확대·스크린리더 작동과는 구분한다.
- 변경은 기존 Nuxt UI·공통 renderer·공개 링크 경계를 재사용한다. 사용자 문서·공개 범위·API 계약·의존성 변경은 없다.

## 검증 근거

- `VERIFY_PASS`: 기존 공개 경계 회귀 **4파일/108개**, 최종 전체 Vitest **66파일/722개**, `pnpm typecheck`, `pnpm build` 통과. 기준과 비교해 신규 실패 없음.
- 줌 플러그인 공개/앱 전환·cleanup을 실제 모듈로 실행한 EventTarget 검사 15개 통과. root 브라우저에서 viewport dedupe·SPA 복귀와 읽기 전용 DOM도 확인했다.
- 운영 익명 읽기: 공개 tree **6폴더/17메모**, desktop1440×1000/mobile390×844, 문서·공개 링크·목록 진입을 확인했다. 프로덕션의 본문·설정은 변경하지 않았다.
- 합성 환경: production 빌드를 127.0.0.1:4742에서 임시 데이터로 실행하고 Google Calendar OFF. 캡처·JSON·로그는 Git 제외 `_workspace/public-audit-2026-11-17/`에 보관한다.
- 도구 측 구분: Ego의 기기 에뮬레이션은 round마다 다시 지정해야 했다. 검색 UInputMenu의 testid는 wrapper가 아닌 input에 있고, 포커스만으로 열리지 않은 회차는 실제 클릭 후 다시 관찰했다. 이 도구/selector 회차를 제품 오류나 통과 수에 섞지 않았다.
- 성능은 실사용 흐름·렌더링의 코드/화면 점검 범위다. CWV·부하 수치와 WCAG 전체 적합성 인증을 주장하지 않는다.
- 사용자 승인에 따른 main commit/push → production workflow를 사용한다. 최종 실행 링크·배포 SHA·외부 asset/health 증거는 최종 응답에 기록한다.

## Deferred QA

### public-page-audit-01
- Priority: P2
- Preconditions: iPhone Safari 또는 WKWebView 실기기, 합성 공개 문서.
- Actions: 실제 손가락 확대·축소와 큰 글자 설정, VoiceOver로 문서·체크 상태·링크를 읽는다.
- Expected: 공개 문서는 확대해 읽을 수 있고 입력칸으로 오인되지 않으며, 체크 상태와 공개 링크가 올바르게 읽힌다. 앱 편집 화면의 기존 확대 정책은 유지된다.
- Source: 공개 읽기 접근성 보완. 브라우저 viewport·gesture event·DOM 의미 검증은 실기기 AT 검증을 대신하지 않는다.
- Status: pending
- Evidence: —
