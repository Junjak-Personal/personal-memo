# 폴더 공개와 공개 링크 탐색

- status: complete
- verification: VERIFY_PASS (자동 검사·데스크톱 공개 흐름)
- qa: pending (2 scenarios)
- baseRef: 89f599ad61ad8e8232977f119ab3334ab635a001
- startedAt: 2026-11-03T17:08:53Z
- branch: feat/folder-public-navigation
- 범위: 폴더 공개/해제·링크 복사, 공개된 항목만 나오는 익명 LNB. 기존 개인 메모·데이터·iOS/Tauri 코드 보존. 운영 데이터/공개 설정 변경·push·배포 없음.

## 동작

폴더 공개 상태를 하위 폴더·메모에 상속한다. 이후 만들거나 옮겨 넣은 항목도 같은 규칙을 따른다. 공개를 끄면 개별 공개한 메모와 별도 공개한 하위 폴더는 유지한다. 공개 페이지의 LNB는 탐색 메뉴이며 편집 기능은 없다. 공개되지 않은 조상 폴더 이름·경로·태그·날짜·검색 발췌·휴지통/이력/템플릿은 공개 응답에 넣지 않는다.

기존 개별 메모 `/ext/:id`를 유지하고, 폴더는 `/ext/folder/:id`로 연다. 공개 요청은 기존 이미지 allowlist를 유지하며 폴더 공개를 해제하면 상속 메모와 이미지 요청도 거절한다. ID 없는 외부 Markdown도 파일을 익명 읽기에서 고쳐 쓰지 않고 안전한 불투명 공개 ID로 표시한다. 전체 vault 루트 공개는 제공하지 않는다.

```mermaid
flowchart LR
  Owner[소유자 폴더 메뉴] --> Confirm[하위 항목 공개 안내·확인]
  Confirm --> Setting[폴더 공개 메타데이터 저장]
  Setting --> Policy[개별 공개 또는 조상 폴더 공개]
  Policy --> PublicTree[공개 항목만 담은 탐색 API]
  PublicTree --> LNB[공개 페이지 LNB]
  Policy --> Memo[읽기 전용 메모·참조 이미지만 제공]
```

## 파일 소유권

- backend agent: shared/types/memo.ts, server/memo, 공개/소유자 폴더 API. 임시 파일시스템에서 권한 경계 회귀 검사.
- UI agent: AppSidebar·폴더 공개 dialog·ext 페이지/공개 LNB. 기존 Nuxt UI와 테마 재사용.
- root: 기존 메모 메뉴의 상속 표시·링크 복사, 통합·문서·확인.

## 확인 범위

변경 관련 권한/파일시스템 테스트와 최종 타입검사·빌드 각 1회. 준비된 합성 환경에서 공개 메뉴와 LNB를 하나의 짧은 흐름으로 확인한다. 광범위한 native/플랫폼 QA는 진행하지 않는다. 인증·비공개 데이터 노출 경계는 별도 코드 검토한다.


## 구현과 확인 결과

- `FolderPublicIndex`가 폴더별 `.public.json`을 읽고 명시 공개·상속 공개를 분리한다. 기존 메모 원문 일괄 변경이나 익명 조회의 쓰기는 없다. 폴더 이동/이름 변경은 메타와 함께 처리하며, 상속 항목은 위치에 따라 권한을 다시 계산한다.
- `publicTree`는 공개 필드만 새로 구성한다. ID 없는 메모와 상속 폴더는 공개 루트의 무작위 ID와 공개 상대경로로 참조를 계산한다. 비공개 조상 경로는 반환값과 참조 입력에 포함하지 않는다. 메모·이미지는 동일한 유효 공개 판정을 따른다.
- 폴더 메뉴의 공개·해제·링크 복사, 상속 상태 표시, 공개 전 하위/향후 항목 안내, 공개 전용 반응형 LNB·폴더 목록 화면을 연결했다. 기존 메모 단독 링크와 내부 비공개 링크 차단을 유지했다.
- 전용 보안 검토: 공개 DTO 필드 제한, 폴더 설정 인증, 원문/이미지 권한 재조회, no-store, 숨김·심볼릭 링크·손상·과대·특수 파일·중복 마커 처리, 익명 읽기 무변경을 코드로 확인. 확실한 신규 권한·비공개 정보 노출·데이터 손실 결함을 발견하지 못했다.

| 확인 | 실제 결과 | 근거 |
| --- | --- | --- |
| 변경된 저장소 회귀 | 폴더 공개 11개 + 기존 store 68개, 79개 통과 | backend focused run |
| 최종 통합 테스트 | 58파일 / 612개 PASS, 3.21초 | `_workspace/folder-public-navigation/tests.log` |
| 타입 | `pnpm typecheck` exit0 | `typecheck.log` |
| 빌드 | `pnpm build --dotenv _workspace/desktop-10/.env.test` exit0 | `build.log` |
| 실제 화면 | 합성 데이터에서 폴더 메뉴→공개 안내/확인→공개 폴더→LNB 하위 메모 선택·본문 표시 | `publish-dialog.png`, `public-folder.png`, `public-memo.png` |
| 익명 HTTP | 트리200, 비공개 조상 이름·경로 없음, 상속 메모200, 비공개 메모404 | `anonymous-check.json` |

브라우저 조작 도구에서 selector 표현 오류 1회가 있었지만, 공개 저장이 이미 반영된 현재 상태를 읽어 중복 저장 없이 이어갔다. 앱 오류나 테스트 실패로 분류하지 않는다. 테스트 서버는 `_workspace/folder-public-navigation/data`만 사용하고 캘린더는 껐다. 실제 vault 데이터·공개 설정 변경, 이 기능의 커밋·push·배포는 하지 않았다. 브라우저 공간과 소유 서버는 종료했다.

## Deferred QA

### 2026-11-04-folder-public-navigation-01
- Priority: P2
- Preconditions: 합성 공개 폴더, 모바일 브라우저 또는 iPhone WebView.
- Actions: 좁은 화면에서 공개 목록을 열고 하위 폴더/메모를 선택한 뒤 닫기·배경 누르기와 스크롤을 확인한다.
- Expected: 공개 목록만 표시되고 선택 후 목록이 닫히며 본문을 정상적으로 읽을 수 있다.
- Source: 반응형 공개 LNB, 이번 smoke는 데스크톱만 실행.
- Status: pending
- Evidence: —

### 2026-11-04-folder-public-navigation-02
- Priority: P2
- Preconditions: 합성 폴더와 미저장 편집 내용, 저장 오류를 주입할 수 있는 로컬 환경.
- Actions: 폴더 공개 확인 시 편집 저장을 실패시키고 다시 시도한 뒤 공개 링크 복사를 확인한다.
- Expected: 저장 실패 시 공개 설정은 유지되고 오류가 보이며, 재시도 성공 후 올바른 링크가 복사된다.
- Source: FolderPublicDialog의 flush·오류 흐름. 정상 공개·탐색만 실제 smoke로 실행.
- Status: pending
- Evidence: —

## 배포 승인

2026-11-04 사용자 「폴더 공개 기능 배포 ㄱㄱ」로 main 반영과 기존 Deploy workflow 배포를 승인했다. 앞의 커밋·push·배포 없음 표기는 구현 검증 시점 기록이다. 배포는 코드만 반영하며 실제 폴더 공개 설정은 바꾸지 않는다.
