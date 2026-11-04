---
title: 공개 체험용 stage 환경
status: complete
topic: stage-demo
kind: implementation
scope: deployment
created: 2026-11-04
updated: 2026-11-04
owner: Junjak
---

# 공개 체험용 stage 환경

- 시작 기준: `ad29a25caeb87db32b9fa665daa22ade72f56b88`, 2026-11-03T17:28:47Z.
- 사용자 승인: 개인 서버 localhost:4701에 견본 데이터를 넣은 테스트 웹 환경, 공개 체험용 공통 비밀번호, `memo-test.jun-devlog.win`을 저장소 Website에 연결.
- 작업 공간: `feat/stage-demo`, 별도 worktree. 기존 README·MIT 라이선스 작업을 함께 보존한다.

## 범위

1. 현재 운영 이미지의 immutable ID와 checkout revision을 대조한 뒤 같은 이미지를 stage로 복제한다.
2. `personal-memo-stage`, `apps/personal-memo-stage/data`, 127.0.0.1:4701을 사용한다. 운영 컨테이너·볼륨·인증정보와 분리한다.
3. 새로운 세션 키와 공개용 비밀번호 해시를 만들고 Google Calendar 키는 전부 비운다.
4. 허용된 stage origin에만 기존 인증 API로 합성 데이터를 추가한다. 재실행 시 기존 메모를 덮어쓰거나 삭제하지 않는다.
5. README의 기술 설명·크로스플랫폼 구성·체험 링크와 GitHub Website를 정리한다.

## 검증 기준

- 시드의 운영 origin 거부, 재실행 시 기존 수정 보존을 Node 테스트로 확인.
- Bash 구문·문서 링크와 변경 범위를 확인.
- stage 이미지 SHA·포트·볼륨·캘린더 비활성 설정을 값 노출 없이 확인.
- 외부 HTTPS에서 로그인·견본 메모 조회·샘플 수정 저장을 한 번 확인.
- 운영 컨테이너 ID·이미지 ID가 배포 전후 같은지 대조.

## 결과

- `VERIFY_PASS`: 시드 Node 테스트 7/7, `node --check`, `bash -n`, 문서 링크·명령 구문 검사 통과.
- 웹 런타임 소스는 변경하지 않았다. 새 웹 빌드 대신 현재 운영의 검증된 이미지 `sha256:0e1a7a16e00280ef85f13d404a91233ed6695804967c3fb294a7288bc04499e3`를 복제했다. 이미지 revision은 기준 SHA와 일치한다.
- `personal-memo-stage`가 `127.0.0.1:4701 -> 4700`, `/home/junja/apps/personal-memo-stage/data -> /app/data`로 실행 중이다. 별도 stage 세션 이름과 캘린더 키 비활성을 값 노출 없이 확인했다.
- 외부 HTTPS 헬스체크·공개 계정 로그인·5개 폴더/15개 메모 조회 성공. 재시드 결과 추가 0, 기존 15개 유지.
- 실제 브라우저에서 표·서식·코드 블록이 있는 견본을 열고 체크 항목 변경 → 서버 저장 → 새로고침 후 유지까지 확인했다. 화면 근거: `_workspace/stage-demo/demo.png`.
- 배포 전후 운영 컨테이너 ID `64f02a117a80b7c847a6470f81b35b78f0579088777d1f03c7f23f995a5d7f48` 및 이미지 ID 동일. 운영 4700 헬스체크 정상.
- GitHub 저장소 homepage를 `https://memo-test.jun-devlog.win`으로 수정하고 API 응답으로 확인했다. 연결 도구에 저장소 Website 변경 기능이 없어 GitHub CLI의 개인 계정을 사용했다.
- 시드는 운영 origin과 운영 세션 쿠키를 거부하고, 기존 데이터에 수정·삭제 요청을 보내지 않는다. 단, 방문자가 견본의 제목이나 위치를 바꿨으면 재시드 시 원래 견본이 추가될 수 있다.
- README의 기술 설계·웹/Flutter/Tauri 구성·체험 링크와 MIT 라이선스를 준비했다. 사용자가 후속으로 커밋·푸시·저장소 공개 전환을 승인했다. 최종 공개 상태와 커밋은 GitHub 저장소에서 확인한다.
- stage 시드의 Node 테스트를 기존 CI 검증 job에도 포함했다. 개인 서버의 러너와 기존 배포 조건은 유지한다.
- 공개 준비 검증: 타입 검사·앱 단위 테스트 612개·시드 테스트 7개·빌드 통과. Git 이력 73개 커밋/834개 blob과 작업 파일 430개를 실제 로컬 비밀값 및 주요 인증정보 패턴으로 검사했으며 미검출이다.
- 기존 Actions 실행 45개 전체의 로그 ZIP·로그 파일 164개를 메모리에서 검사했고 조회 실패·비밀값 패턴 검출은 없었다. 아티팩트 0개, 이슈 본문 6개·PR 본문 6개·리뷰 본문 1개도 검사했다. 이후 생성되는 실행은 이 검사 범위에 포함하지 않는다.

## Deferred QA

### stage-demo-01

- Priority: medium
- Preconditions: stage 컨테이너 실행 및 견본 메모 존재
- Actions: stage만 재시작한 뒤 로그인하고 메모·수정 내용을 조회한다.
- Expected: 마운트된 stage 데이터가 유지되며 운영 컨테이너는 변경되지 않는다.
- Source: 데이터 경로 분리와 재배포 유지 요구
- Status: pending
- Evidence: —

### stage-demo-02

- Priority: medium
- Preconditions: 별도 브라우저 두 개에서 체험 계정으로 같은 메모 열기
- Actions: 한쪽에서 저장 후 다른 쪽에서 기존 버전으로 저장한다.
- Expected: 후자의 저장에 충돌이 표시되고 먼저 저장한 내용을 자동으로 덮어쓰지 않는다.
- Source: 공개 체험 환경의 공동 계정과 기존 baseVersion 규칙
- Status: pending
- Evidence: —
