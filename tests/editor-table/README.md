# HTML 셀 병합 브라우저 회귀 검사

Node Vitest에는 DOM 구현이 없으므로 HTML 입력 경로는 실제 브라우저에서 검사한다. 새 의존성이나 운영용 화면을 추가하지 않는다.

저장소 루트에서 다음 명령을 실행한다. 스크립트는 이미 설치된 Vitest의 Vite CLI를 사용한다.

```sh
node tests/editor-table/run.mjs
```

`http://127.0.0.1:4731/`에서 **회귀 검사 실행**을 한 번 누른다. 13개 항목의 PASS/FAIL과 최종 상태가 화면에 표시된다. 전체 성공 기준은 status 요소의 `data-state="passed"`다. 종료는 Ctrl+C다.

- 실제 `Editor`·StarterKit·Markdown·`memoExtensions`와 임시 폴더의 실제 MemoStore를 사용한다.
- HTML → 생성 → 재조회 → 편집기 읽기/직렬화 → 본문 추가 → 저장 → 재조회 → 읽기 전용 화면을 검사한다.
- 가로·세로·동시·헤더 병합, 병합 없는 HTML 표·병합 해제 후 HTML 유형 유지·Markdown 클립보드 유형 유지, 반복 저장, 서식/링크/escaped 텍스트/상대 이미지 경로, GFM 호환, 선택적 canonical 비교와 보안 경계를 검사한다.
- 이미지가 포함된 복잡한 표는 내용·경로 보존 검사다. 기존 형식 손실 확인을 완화한다는 뜻은 아니다.
- 테스트 전용 endpoint는 loopback의 정확한 Host/Origin과 이 프로세스에서 만든 ID만 받는다. 본문은 64 KiB 이하로 제한하며 실제 data/나 환경 파일을 읽지 않는다. 프로세스 종료 시 임시 폴더를 정리한다.
- Nuxt 앱의 route/UI나 기본 Vitest 실행을 변경하지 않는다. 이 브라우저 검사는 명시적으로 실행하는 별도 회귀 검사다.
