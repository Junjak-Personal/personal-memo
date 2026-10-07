---
title: 스파이크 S1~S6 — 실측 결과
status: complete
topic: spike
kind: findings
scope: fullstack
created: 2026-10-06
updated: 2026-10-06
owner: jhyoon
related:
  - _docs/reference/product-spec/2026-10-06-product-spec.md
---
# 스파이크 S1~S6 — 실측 결과

설계문서 §15 의 여섯 항목. 전부 2026-10-06 에 쟀다.

| # | 결과 | 근거 |
|---|---|---|
| S1 | ✅ Flutter 툴바 통과 | 실기기 iPhone 15 Pro · iOS 18.7 진단 로그 |
| S2 | ✅ 고친 뒤 통과 (기본 구성은 데이터 손실) | 브라우저에서 UEditor 로 왕복 |
| S3 | ✅ 통과 | 같은 페이지 |
| S4 | ✅ 막대 지원. 단 걷어낼 결합이 크다 | 템플릿 소스 읽기 (실행 안 함) |
| S5 | ✅ 통과 | 실제 「메모」 캘린더에 생성·조회·수정·삭제 |
| S6 | ✅ 통과 (맥 기준) | 벤치 스크립트, N100 uid 조회 |

## S1 — Flutter 툴바 ↔ WKWebView

`app-ios/` 껍데기를 「memo dev」(`win.jundevlog.memo.dev`)로 설치해 `/spike/mobile` 을 열고,
웹·네이티브 사건을 한 로그 파일(`_workspace/spike/s1.log`, 331줄)에 시간순으로 모았다.

```
  3099 editor focus       vv=759+0 win=759 sy=0
  3322 native inset 116   vv=424+0 win=759          ← 키보드가 오르기 시작
  3373 native inset 267   vv=424+0 win=573          ← 웹뷰 높이가 키보드를 따라 준다
  3700 native inset 369   vv=376+0 win=376          ← 끝. offsetTop 은 내내 0
  5023 native tap h1      vv=376+0 win=376 active=DIV
  5024 exec h1
  5051 after h1           caret=205 active=DIV      ← 포커스 그대로
```

- **버튼 탭에 포커스를 안 잃는다.** 탭 5번(h1·h2·h3·bold×2), blur/focusout 0건, 탭 뒤 inset 변화 없음.
  `GestureDetector` 로 받은 것이 맞았다 — 포커스를 요청하는 위젯은 쓰지 않는다.
- **두 번 밀리지 않는다.** 키보드가 오르는 동안 `visualViewport.offsetTop` 이 내내 0 이고
  `innerHeight` 가 759 → 376 으로 키보드를 따라 줄었다. Scaffold 가 웹뷰 틀을 줄이므로 WebKit 이
  시각 뷰포트를 밀 이유가 없다. pic-blog 의 −396 밀림이 여기서는 없다.
- 시작 직후 잠깐 `vv=424` 가 `win=759` 보다 먼저 줄어드는데(WKWebView 자체 보정이 먼저 반응),
  offsetTop 은 0 이라 화면은 안 움직인다.
- offsetTop 이 0 이 아닌 구간은 한 곳(74줄)뿐이다 — 문서 끝에서 더 끌어내린 고무줄 스크롤이고
  `sy` 2979 → 2837 로 스스로 돌아왔다. 결함이 아니다 (pic-blog ios-keyboard 문서의 같은 관찰).
- 사용자 육안 확인: 「잘 나옴」.

로그로는 못 본 두 가지 — 키보드를 내렸을 때 툴바가 사라지는지(로그 끝에 inset 0 이 없다),
iOS 기본 입력 보조 막대(∧ ∨ 완료)와 겹치는지 — 는 사용자가 기기에서 「됨」으로 확인했다.

## S2 — UEditor 마크다운 왕복

`/spike/editor` 에서 `editor.markdown.parse → serialize` 를 샘플마다 돌리고, 결과를 한 번 더 돌려
「두 번째 저장부터 고정되는가」까지 봤다.

### 기본 구성은 데이터를 잃는다

| 입력 | 결과 |
|---|---|
| `- [x] 끝난 일` | `- 끝난 일` — **체크 상태 손실** |
| GFM 표 | **통째로 사라짐** |
| `<u>밑줄 **굵게** 끝</u>` | `<u>밑줄 \*\*굵게\*\* 끝</u>` — **저장할 때마다 역슬래시가 불어남** |

UEditor 기본 확장은 StarterKit·Placeholder·Image·Mention·Markdown 뿐이라 체크리스트·표가 없다.
`<u>` 는 인라인 HTML 토큰으로 들어가 HTML 로 파싱되므로 안쪽 `**` 가 글자가 된다.

### 고친 것

- `TaskList`, `TaskItem({ nested: true })` (`@tiptap/extension-list`), `TableKit` (`@tiptap/extension-table`) 추가
- `app/utils/editor-extensions.ts` 의 `HtmlUnderline`: `<u>…</u>` 를 직접 잘라 안쪽을 인라인 마크다운으로
  다시 읽는다. 내보내기도 `<u>`. 기본 `++` 토크나이저가 없어져 `C++ 와 C++` 도 평문으로 남는다.

### 고친 뒤

| 샘플 | 원문과 같음 | 두 번째부터 고정 |
|---|---|---|
| 앱 문법 (제목·굵게·기울임·취소선·코드·`<u>`·목록·체크리스트·인용·표·코드블록·이미지·링크·구분선) | ❌ 표만 다름 | ✅ |
| `C++ 공부하고 C++ 책` | ✅ | ✅ |
| `<u>밑줄 **굵게** 끝</u>` | ✅ | ✅ |
| `` `<u>x</u>` `` (코드 안) | ✅ | ✅ |
| 외부 도구 스타일 (`*` 목록, `__굵게__`, Setext 제목) | ❌ `-`, `**`, `#` 로 바뀜 | ✅ |
| Tiptap 이 모르는 문법 | ❌ 각주 `\[^1\]`, `<div>` 태그 소실 | ✅ |
| 에디터에서 굵게+밑줄 | `**<u>둘다</u>**` | ✅ |

- 표는 첫 저장에서 앞뒤 빈 줄 하나씩과 칸 너비가 정리된다. 그 뒤로는 그대로다.
- 외부 스타일은 같은 뜻의 다른 표기로 바뀐다 — 손실이 아니다.
- **각주·HTML 블록은 손실**이다 → 설계문서 §7.1 의 왕복 검사 경고가 필수다.

### 같이 발견한 것 — SSR 에서 에디터가 500

표·체크리스트 확장을 넣자 `Adding different instances of a keyed plugin (plugin$)` 로 500 이 났다.
pnpm 에 `prosemirror-state` 는 한 벌뿐이었다(`ls node_modules/.pnpm`). 서버 렌더에서 vite-node 쪽과
Node 쪽이 모듈을 따로 올려 생긴 것으로 보고 `ssr: false` 로 바꾸자 사라졌다 → **SPA 로 확정.**
로그인 뒤에만 있는 앱이라 서버 렌더로 얻는 것이 없다.

## S3 — 이미지 경로 분리

```
화면 <img src>        /api/files/%EC%97%85%EB%AC%B4/assets/01JB7X.jpg
저장 마크다운          ![사진](assets/01JB7X.jpg)
화면 주소 HTML 붙여넣기 ![붙임](assets/01JB7X.jpg)     ← parseHTML 에서 되돌림
```

`MemoImage`(`app/utils/editor-extensions.ts`)가 `src` 속성의 renderHTML/parseHTML 만 바꾸고,
경로 계산은 `shared/utils/asset-path.ts` 가 한다. 다른 폴더 이미지를 붙여넣는 경우는 상대경로로
못 되돌리고 화면 주소가 남는다 — 설계문서 §4 미결.

## S4 — 캘린더 템플릿 월 보기

`nuxt-ui-templates/calendar` 커밋 `6cb92e1` (MIT). 소스만 읽었다.

- `MonthWeek.vue` 가 종일 일정을 `gridColumn: span N` 막대로 그린다. 주 경계를 넘으면 행마다 잘라
  `rounded-s-none`/`rounded-e-none` 으로 이어 보이게 한다. 레인 배치는 `app/utils/layout.ts:98` `layoutAllDay`.
- 주당 막대는 3레인까지, 4번째 칸은 `+N` 용.
- 종일 일정 모델이 `[start, end)` — 끝 날짜 미포함. 우리 `date_end`(포함)는 +1일 해서 넘긴다.
- 🔴 날짜만 있는 문자열(`2026-10-08`)을 `new Date()` 에 넣으면 UTC 로 읽혀 KST 에서 하루가 밀린다.
  어댑터에서 `T00:00:00` 을 붙인다. 틀려도 에러 없이 조용히 어긋난다.
- **결합이 크다**: MonthView/MonthWeek 가 드래그 생성(`useEventDraft`)·이동(`useEventMove`)·팝오버·
  헤더 높이 상수(`HEADER_HEIGHT 64` 등)·라우트와 엮여 있다. 복사보다 걷어내는 일이 크다.
- 그리드 계산은 date-fns + JS `Date`. 주 시작이 월요일로 고정(`weekStartsOn: 1`, 4곳), 포매터 로케일 `en-US` 고정.
- 좁은 화면에서도 7열 고정, 행 높이 140px.
- `+N more` 버튼이 텍스트만 있는 ghost 버튼 — 전역 버튼 규칙에 맞춰 outline 으로 바꿔야 한다.

## S5 — 서비스 계정 + 전용 캘린더

- 키: `/Users/jun/develop/credentials/personal-memo/personal-memo-510813-98853f26f11a.json` (권한 600 으로 좁힘)
- 서비스 계정: `memo-calendar@personal-memo-510813.iam.gserviceaccount.com`
- 캘린더: 「메모」 `c3bcbc009e8214b7d02a67be5f81ea41eb69726b3d2f31c2eafa798c8f29644d@group.calendar.google.com`,
  공개 꺼짐, 공유 권한 「변경 후 모든 일정 세부정보 확인」
  — 「변경(비공개 일정을 한가함/바쁨으로 보기)」이면 비공개로 바뀐 일정의 memoId 가 안 보여 대조에서 중복 생성될 수 있다.

| 확인 | 결과 |
|---|---|
| 토큰 교환 (JWT, scope `calendar.events`) | 200 |
| 목록 읽기 | 200, 기존 0건 |
| 종일 하루 `2026-10-10` | `end.date 2026-10-11` |
| 기간 `2026-10-12 ~ 14` | `end.date 2026-10-15` |
| `privateExtendedProperty=memoId=…` 조회 | 1건 |
| 전체 목록에 `extendedProperties.private.memoId` 가 실려 오는가 | 예 |
| 제목·날짜 수정 후 memoId 유지 | 예 |
| 삭제 후 조회 | 0건 (테스트 일정 남기지 않음) |

**미확인**: 결제 계정 없이도 되는가 — 이미 결제 계정이 연결된 상태라 가리지 못했다. 운영에는 영향 없다.

## S6 — 재스캔 시간, 파일 소유자

맥(M4 Pro, SSD)에서 `scratchpad/s6/bench.mjs`:

| 파일 수 | 첫 스캔(전부 읽기) | 재스캔(변경 없음) | 재스캔(5개 변경) | 본문 검색 |
|---|---|---|---|---|
| 3,000 | 84 ms | 14 ms | 12 ms | 0.4 ms |
| 10,000 | 238 ms | 30~37 ms | 32 ms | 1.7 ms |

10,000개면 본문이 1,350만 자 — 메모리에 올려도 수십 MB 다.
**N100 에서는 재지 않았다.** CPU 가 느린 만큼 몇 배 늘겠지만 요청 직전 재스캔으로 문제 될 크기는 아니라고 본다.

N100: `uid=1000(junja)` — 컨테이너 node(uid 1000)와 같다. vim 으로 고친 파일과 앱이 쓴 파일의 소유자가 맞는다.

## 스파이크 중 바뀐 것 (설계문서에 반영)

- SPA (`ssr: false`)
- TypeScript 6.0.3 — 7.0.2 는 vue-tsc 3.3.12 가 `ERR_PACKAGE_PATH_NOT_EXPORTED (./lib/tsc)` 로 못 돈다
- nuxt 4.6.0 계열 7개가 pnpm 최소 릴리스 경과 정책 예외(`pnpm-workspace.yaml`)
- 에디터 확장: TaskList·TaskItem·TableKit 필수, `HtmlUnderline`, `MemoImage`
- 개발 서버 `vite.server.allowedHosts: ['.local']` — 폰 껍데기가 `맥이름.local` 로 붙는다
