# 병합 표 외곽선·모서리 수정

- status: complete
- verdict: VERIFY_PASS
- completedAt: 2026-10-20 (KST)
- baseRef: 0ea47492ebf7e3278a112258fef9dad73fd2774f
- 승인: 사용자의 border 중첩/rounded 수정, 라이트·다크 검증 후 기존 조건부 배포 승인으로 진행. 실제 메모 수정 금지.
- 최초 배포: run 39379384136은 취소 요청 도달 전 완료(success). 취소 호출은 completed라 거절되어 실행되지 않았다. 운영 health ok, build 9b880b69-bd92-434c-abf0-99371fd670e3. 추가 배포는 수정·검증 전까지 보류한다.
- 원인: app.config.ts의 th border-top, td/th first:border-s, tr:first/last-child 기반 rounded는 DOM 순서 기준이다. rowspan 아래 행의 첫 DOM 셀은 실제 첫 열이 아니므로 span 셀의 border-e와 border-s가 겹치고, 내부 셀에 rounded가 붙는다.

## 설계/검사

1. 기존 ProseMirror TableMap으로 각 셀의 논리적인 rect(left/right/top/bottom)를 읽는다.
2. transient node decoration class로 실제 위/왼쪽 외곽과 네 모서리를 표시한다. 저장 내용·표 유형·span은 변경하지 않는다.
3. 기본 border-b/e에 실제 외곽의 border-t/s만 추가하고 DOM first/last 선택자를 제거한다. 같은 규칙으로 일반 표도 기존 모양을 유지한다.
4. 명시 회귀: 개발 rowspan 셀의 좌하단은 rounded, 검증 내부 셀의 좌하단은 직각·추가 왼쪽 border 없음. colspan 및 여러 span 조합과 편집 후 재계산도 검사한다.
5. Node 단위/기존 전체 테스트·타입/빌드, 실제 개발 앱의 라이트·다크에서 일반/가로/세로 병합을 확인한다. 관련 파일만 커밋하고 사용자 승인 범위 내 후속 배포, CI 최종 성공·운영 반영 확인.

## 실제 검증 결과

- Vitest 전체 33파일 332개 통과, exit 0. 새 TableMap 단위 검사 6개 포함.
- Nuxt typecheck exit 0, Nuxt build exit 0 (11.4초). 새 의존성 없음.
- Chrome 실제 Editor/임시 MemoStore 브라우저 fixture 16/16 PASS. rowspan 개발BL/검증 내부, colspan 위 두 모서리, 문서 편집/위치 변경, HTML/GFM 저장 유형과 기존 보안 검사 통과.
- 실제 Nuxt 개발 앱 localhost:4721의 별도 합성 메모에서 일반 GFM·rowspan·colspan/rowspan 동시 병합을 라이트/다크 모두 확인. 개발 외곽 좌하단 rounded·검증 내부 좌하단 직각·중복 선 제거, colspan 헤더 양쪽 위 모서리 정상. Chrome DevTools prefers-color-scheme 에뮬레이션은 검사 후 원복.
- 읽기 전용 최종 검토: 차단 사항 없음. 기존 표 편집 플러그인 유지, decoration 위치/문서 변경 갱신과 serializer 비침범 확인.
- git diff --check 통과. 원본 checkout·운영 데이터·실제 메모·일지·자격 증명·지속 권한 변경 없음. 기존 미추적 두 경로 보존.
- 증거: `_workspace/e2e/2026-10-20-table-spans/style-{tests,typecheck,build}.log`, `style-browser-result.txt`, `style-browser-pass.png`, `style-{light,dark}.png`, `style-combo-{light,dark}.png`.
- iPhone Safari/Flutter WebView 실기기 표 렌더링은 미검증. 기존 HTML 표 기능의 iOS·복잡 HTML·실제 OAuth/MCP QA pending 항목 유지. 공통 웹 표 스타일이며 네이티브 변경 없음.

## 문서/배포

- active 계획을 이 완료 기록으로 이동. 프로필 index/UI 규칙/설계 SSOT 같은 변경에 반영. 이번 변경 링크·상태·경로·중복·검증·SSOT를 확인했다.
- 사용자 「ㅇ 배포」와 기존 조건부 승인에 따라 정상 main push → 기존 Deploy Actions 경로로 후속 배포한다. CI와 운영 반영 최종 결과는 로컬 배포 증거 및 최종 보고로 남긴다.
- 앞선 0ea4749 최초 배포는 완료 후 취소 요청이 도달해 취소되지 않았다. 공통 CSS라는 이유로 병합 외곽까지 정상으로 판단한 이전 검토는 부정확했고 이번 명시적인 격자/시각 검사로 바로잡았다.
