# iOS 운영 앱 「memo」 — 작업 결과 (2026-10-08)

> Claude 세션 `personal-memo-ff` 에서 사용자 요청으로 넘긴 작업을 Codex 가 구현했다.
> **push 하지 않았다.** 운영 서버·데이터·비밀번호는 건드리지 않았다.

## 됐다

- `app-ios/lib/main.dart` 의 `kSite` 기본값은 `https://memo.jun-devlog.win`.
- 운영 설치: 저장소 루트에서 `app-ios/tool/prod-install.sh`.
  기존 `dev-install.sh` 의 빌드·검증·설치를 재사용하고, 운영은 App Group 없이 대체 설치하지 않는다.
  앱·확장 id, 앱 이름, 번들 안 SITE, 실제 서명과 Info.plist 의 App Group 을 검사한 뒤 설치한다.
  dev 환경변수(SITE·BUNDLE_ID·APP_NAME)가 운영 대상에 섞이지 않는다.
- 운영 앱 정체는 기존 `ios/AppIdentity.xcconfig` 와 실제 개발 앱을 따른다:
  「memo」 `win.jundevlog.memo`, 공유 확장 `win.jundevlog.memo.share`, 그룹 `group.win.jundevlog.memo`.
  원래 인계 문서의 `win.jun-devlog.memo` 는 현재 코드·설치된 dev 앱과 달라 기존 값을 유지했다.
- 사용자가 준 책·펜 PNG 를 같은 로고로 적용했다. 새로 그리지 않고 투명 여백·크기만 변환했다.
  iOS 아이콘 15개(불투명 배경), 시작 화면 3개, 웹 로그인·사이드바·빈 화면 로고,
  favicon(`public/favicon.png`), Apple 홈 화면 아이콘(`public/apple-touch-icon.png`).
- 운영 릴리스 빌드 성공. Xcode 27.0 / 팀 `7D92AXK55P` 의 자동 서명으로 App ID·프로파일 생성,
  앱·확장 모두 운영 App Group 이 실제 서명과 프로파일에 있는 것을 확인했다.
  산출물: `app-ios/build/prod-dd/Build/Products/Release-iphoneos/Runner.app`.
- iPhone 15 Pro 재연결 후 `prod-install.sh` 로 기기 설치·앱 실행 완료.
  기기 목록에 「memo」/「memo dev」가 함께 있고 App Group 도 운영·개발로 분리돼 있다.
  폰 화면 캡처에서 로그인된 운영 메모 화면이 열린 것을 확인했다. 운영 비밀번호는 입력하지 않았다.
- 검증: `flutter analyze`, `pnpm typecheck`, `pnpm test` 143개, `pnpm build`, `codesign --verify --deep --strict` 통과.
  임시 명령 대역으로 설치 분기 8개 통과(운영 성공·헬스 실패·서명 실패·id 불일치·그룹 불일치,
  dev 성공·대체 설치, 기기 없음). 저장소에 테스트용 파일·의존성을 추가하지 않았다.
- 웹 로고를 임시 데이터 폴더의 로컬 운영 빌드에서 확인했다. 로그인(밝은 모바일·어두운 PC),
  사이드바·빈 화면(빈 목록을 흉내 낸 응답), 이미지 로드·favicon/Apple 아이콘 링크 확인.
- 설계문서 §10·§13·§16 갱신.
- 모바일 후속 수정(2026-10-08): 표 내부 가로 스크롤, 네이티브 커서 가림 보정, 레이아웃 공통 헤더,
  44px 메뉴 버튼·길게 누르기, 메모 생성/이동/삭제 메뉴, 별도 로그아웃 행 구현.
  로컬 UI → API → 임시 파일 → 새로고침/재진입으로 생성·이동·삭제·되돌리기를 확인했다.
  [완료 기록·남은 실기기 QA 3건](../complete/implementation/2026-10-08-mobile-editor-sidebar.md).

## 미검증

- **폰에서 남은 확인:** 홈 화면의 새 아이콘, 초기 운영 로그인 화면(캡처 때 이미 로그인된 화면),
  공유 시트 → 「받은 메모」, 사이드바 할 일 체크가 메모를 열지 않는 것, 설계문서 §16 나머지 항목.
  로그인된 화면을 열고 캡처만 했으며, 운영 데이터를 바꾸는 검증은 실행하지 않았다.
- **웹 로고 운영 반영은 미배포:** 로컬 구현·빌드·표시 확인까지 완료. push 는 사용자 지시가 있을 때만.
- **모바일 후속 수정 운영 반영·실기기 확인은 미배포/미검증:** 로컬 타입·143개 테스트·빌드·영향받은 UI 흐름 확인 완료.
  실제 iPhone의 키보드/툴바 타이밍과 손가락 길게 누르기는 운영 반영 후 확인해야 한다.

## 다음 확인

- 모바일 후속 수정: [완료 기록](../complete/implementation/2026-10-08-mobile-editor-sidebar.md).

1. `git status` 로 Claude 세션의 동시 변경을 확인한다.
2. 폰에서 「memo」의 새 아이콘과 설계문서 §16 의 남은 항목을 사용자가 확인한다.
3. 앱을 다시 설치할 때는 아이폰을 연결하고 잠금을 푼 뒤 저장소 루트에서 `app-ios/tool/prod-install.sh`.
   여러 대면 `DEVICE=<기기 id> app-ios/tool/prod-install.sh`.
4. 웹 로고·favicon 은 사용자 push 지시 후 운영에 반영한다.
5. 새 확인 결과에 맞춰 이 문서와 설계문서 §13·§16 을 갱신한다.
