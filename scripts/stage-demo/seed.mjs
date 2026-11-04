// 공개 체험 환경에 견본을 추가한다. 운영 주소는 거부하고, 기존 메모는 수정하거나 지우지 않는다.
// 실행: node scripts/stage-demo/seed.mjs [--url http://127.0.0.1:4701]
// MEMO_STAGE_PASSWORD가 없으면 README에 공개하는 체험용 비밀번호를 사용한다.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_URL = 'http://127.0.0.1:4701'
const PUBLIC_DEMO_PASSWORD = 'memo-demo'

export function stageOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('체험 환경 URL 형식이 올바르지 않습니다')
  }
  const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '4701'
  const published = url.origin === 'https://memo-test.jun-devlog.win'
  if ((!loopback && !published) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('시드는 localhost:4701 또는 memo-test.jun-devlog.win 체험 환경에서만 실행할 수 있습니다')
  }
  return url.origin
}

export function demoMemos(now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)
  const day = (offset) => {
    const date = new Date(`${today}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  }
  return [
    {
      folder: '시작하기', title: '마크다운 편집을 연습해 보세요', tags: ['가이드', '편집기'],
      content: '## 자유롭게 고쳐 보세요\n\n**굵게**, *기울임*, <u>밑줄</u>, ~~취소선~~을 지원합니다.\n\n### 체크리스트\n\n- [x] 견본 메모 열기\n- [ ] 문장 하나 수정하기\n- [ ] 새 메모 만들기\n\n### 표\n\n| 기능 | 사용 방법 |\n| --- | --- |\n| 저장 | 입력을 멈추면 자동 저장 |\n| 태그 | 메모에 태그를 붙여 모아 보기 |\n| 링크 | 다른 메모를 내부 링크로 연결 |\n\n### 코드 블록\n\n```js\nconst memo = { title: "나의 첫 메모", tags: ["연습"] }\nconsole.log(memo.title)\n```\n',
    },
    {
      folder: '시작하기', title: '웹·모바일·데스크톱에서 같은 메모', tags: ['가이드', '크로스플랫폼'],
      content: '## 하나의 편집기와 저장소\n\n- 웹: Nuxt/Vue 화면을 브라우저에서 사용합니다.\n- 모바일: Flutter iPhone 앱에서 같은 웹 화면과 네이티브 툴바를 사용합니다.\n- 데스크톱: Tauri 앱에서 같은 서버와 편집기를 사용합니다.\n\n이 체험 사이트에서는 웹 버전을 둘러볼 수 있습니다. 폴더, 태그, 검색, 할 일, 캘린더 메뉴를 눌러 보세요.\n',
    },
    {
      folder: '프로젝트', title: '작은 프로젝트 시작하기', tags: ['프로젝트', '기획'],
      content: '## 동네 책 교환 모임\n\n이 문서는 가상의 프로젝트 예시입니다.\n\n### 목표\n\n한 달에 한 번 책을 나누고 짧은 감상을 이야기하는 모임을 만듭니다.\n\n### 첫 모임 준비\n\n1. 날짜와 장소 정하기\n2. 가져올 책 한 권 고르기\n3. 참가 안내문 작성하기\n\n### 진행 기준\n\n| 항목 | 계획 |\n| --- | --- |\n| 참가 인원 | 6명 안팎 |\n| 진행 시간 | 90분 |\n| 준비물 | 책 한 권, 짧은 소개 |\n',
    },
    {
      folder: '프로젝트', title: '회의 기록 예시', tags: ['프로젝트', '회의'],
      content: '## 이번 주 이야기\n\n### 정한 내용\n\n- 첫 모임은 가벼운 자기소개로 시작합니다.\n- 책을 읽지 않았어도 참가할 수 있습니다.\n- 다음 모임 주제는 참가자 의견을 받아 정합니다.\n\n### 다음에 확인할 내용\n\n- [ ] 장소 예약 가능 시간\n- [ ] 안내문에 넣을 사진\n\n> 회의 기록을 쌓아 두고 태그로 모아 보세요.\n',
    },
    {
      folder: '프로젝트', title: '프로젝트 살펴보기', tags: ['프로젝트', '정리'],
      content: (link) => `## 프로젝트 문서 모음\n\n- ${link('프로젝트', '작은 프로젝트 시작하기')}\n- ${link('프로젝트', '회의 기록 예시')}\n\n문서를 연결하면 참조하는 메모를 백링크로 확인할 수 있습니다.\n`,
    },
    {
      folder: '기록', title: '오늘의 짧은 기록', tags: ['일상', '기록'], date: day(0),
      content: '## 오늘 기억하고 싶은 것\n\n아침에 조금 일찍 나가 천천히 걸었습니다. 평소 지나치던 작은 가게와 골목이 눈에 들어왔습니다.\n\n### 좋았던 점\n\n- 할 일을 시작하기 전에 머리를 비울 수 있었습니다.\n- 떠오른 아이디어를 바로 메모했습니다.\n\n일반 메모의 날짜는 기록용입니다. 날짜를 넣어도 할 일이 아니면 일정으로 내보내지 않습니다.\n',
    },
    {
      folder: '기록', title: '읽고 싶은 책 목록', tags: ['독서', '목록'],
      content: '## 다음에 읽을 주제\n\n- [ ] 동네의 역사와 공간에 관한 책\n- [ ] 식물 키우기 입문서\n- [x] 짧은 여행 에세이\n\n### 읽으며 적을 질문\n\n1. 새롭게 알게 된 것은 무엇인가?\n2. 내 경험과 연결되는 부분은 어디인가?\n3. 다음에 더 알아보고 싶은 것은 무엇인가?\n',
    },
    {
      folder: '아이디어', title: '주말 산책 지도', tags: ['아이디어', '여행'],
      content: '## 자주 걷는 길을 모아 보기\n\n출발점, 쉬는 곳, 걸린 시간을 짧게 기록하면 나만의 산책 지도가 될 것 같습니다.\n\n| 코스 | 예상 시간 | 쉬는 곳 |\n| --- | --- | --- |\n| 강변 한 바퀴 | 40분 | 벤치 |\n| 골목과 공원 | 60분 | 작은 카페 |\n\n다음에는 사진과 함께 기록해 봅니다.\n',
    },
    {
      folder: '아이디어', title: '요리 메모 템플릿', tags: ['아이디어', '템플릿'],
      content: '## 요리 이름\n\n### 재료\n\n- 주재료:\n- 양념:\n\n### 만드는 순서\n\n1. 재료를 손질합니다.\n2. 조리합니다.\n3. 맛을 보고 기록합니다.\n\n### 다음에 바꿔 볼 것\n\n메모 메뉴에서 템플릿으로 저장한 뒤 새 메모를 만들어 보세요.\n',
    },
    {
      folder: '아이디어', title: '검색과 태그 사용하기', tags: ['가이드', '정리'],
      content: '## 흩어진 메모 찾기\n\n제목이나 본문의 단어로 검색해 보세요. 예를 들어 「책」을 검색하면 프로젝트와 독서 기록을 함께 찾을 수 있습니다.\n\n태그 화면에서는 「프로젝트」, 「아이디어」, 「가이드」처럼 같은 태그가 붙은 메모를 모아 볼 수 있습니다. 한 메모에 여러 태그를 붙여도 됩니다.\n',
    },
    {
      folder: '할 일', title: '체험 사이트에서 첫 메모 만들기', tags: ['체험', '오늘'], date: day(0), done: false, priority: 'high',
      content: '새 메모를 만들고 짧은 문장을 적어 보세요. 자동 저장이 끝난 뒤 다른 메뉴에 갔다가 다시 열어 봅니다.\n',
    },
    {
      folder: '할 일', title: '주말 산책 코스 정하기', tags: ['일상', '계획'], date: day(2), dateEnd: day(3), done: false,
      content: (link) => `산책할 코스를 하나 골라 보세요.\n\n관련 아이디어: ${link('아이디어', '주말 산책 지도')}\n`,
    },
    {
      folder: '할 일', title: '책 교환 모임 안내문 쓰기', tags: ['프로젝트', '준비'], done: false, priority: 'low',
      content: '날짜가 정해지면 할 일에 날짜를 넣어 보세요. 날짜가 없는 할 일은 할 일 목록에서 관리합니다.\n',
    },
    {
      folder: '할 일', title: '메모 앱의 메뉴 둘러보기', tags: ['체험', '완료'], date: day(-1), done: true,
      content: '완료된 할 일 예시입니다. 완료 목록에서 확인하거나 다시 미완료로 바꿀 수 있습니다.\n',
    },
    {
      folder: '시작하기', title: 'personal-memo 체험에 오신 것을 환영합니다', tags: ['가이드', '체험'],
      content: (link) => `## 마음껏 둘러보세요\n\n이곳은 견본 데이터가 들어 있는 공개 체험 환경입니다. 실제 개인 메모와 분리되어 있고 Google Calendar 연동도 꺼져 있습니다.\n\n### 처음이라면\n\n1. ${link('시작하기', '마크다운 편집을 연습해 보세요')}\n2. ${link('프로젝트', '프로젝트 살펴보기')}\n3. ${link('아이디어', '검색과 태그 사용하기')}\n\n여러 방문자가 함께 사용하는 공간입니다. 개인 정보나 실제 업무 자료는 입력하지 마세요. 메모와 폴더는 자유롭게 만들어 보셔도 됩니다.\n\n견본은 모두 가상의 예시이며 시드를 다시 실행해도 기존 메모를 덮어쓰지 않습니다.\n`,
    },
  ]
}

function memoKey(folder, title) {
  return JSON.stringify([folder, title])
}

export async function seedDemo({ url = DEFAULT_URL, password = process.env.MEMO_STAGE_PASSWORD ?? PUBLIC_DEMO_PASSWORD, fetchImpl = fetch, now = new Date() } = {}) {
  const origin = stageOrigin(url)
  if (!password) throw new Error('체험 환경 로그인 비밀번호가 비어 있습니다')
  const cookies = new Map()
  async function request(method, path, body) {
    const response = await fetchImpl(origin + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    })
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';', 1)[0]
      const separator = pair.indexOf('=')
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
    if (!response.ok) throw new Error(`체험 환경 API 요청 실패: ${method} ${path} (HTTP ${response.status})`)
    return response.json()
  }

  await request('POST', '/api/auth/login', { password })
  if (!cookies.get('memo-stage-session')) {
    throw new Error('체험 환경 전용 세션 쿠키를 확인하지 못해 시드를 중단했습니다')
  }
  const tree = await request('GET', '/api/tree')
  if (!Array.isArray(tree?.folders) || !Array.isArray(tree?.memos)) throw new Error('체험 환경의 메모 목록 응답이 올바르지 않습니다')
  const folders = new Set()
  const collectFolders = (nodes) => {
    for (const node of nodes) {
      if (typeof node?.path !== 'string' || !Array.isArray(node.children)) throw new Error('체험 환경의 폴더 응답이 올바르지 않습니다')
      folders.add(node.path)
      collectFolders(node.children)
    }
  }
  collectFolders(tree.folders)
  const memos = new Map()
  for (const memo of tree.memos) {
    if (typeof memo?.id !== 'string' || typeof memo.folder !== 'string' || typeof memo.title !== 'string') throw new Error('체험 환경의 메모 응답이 올바르지 않습니다')
    memos.set(memoKey(memo.folder, memo.title), memo)
  }
  const link = (folder, title) => {
    const memo = memos.get(memoKey(folder, title))
    if (!memo) throw new Error('견본 내부 링크의 대상 메모가 없습니다')
    return `[${title}](/m/${encodeURIComponent(memo.id)})`
  }

  let createdFolders = 0
  let createdMemos = 0
  let skippedMemos = 0
  for (const sample of demoMemos(now)) {
    if (!folders.has(sample.folder)) {
      await request('POST', '/api/folders', { parent: '', name: sample.folder })
      folders.add(sample.folder)
      createdFolders++
    }
    const key = memoKey(sample.folder, sample.title)
    if (memos.has(key)) {
      skippedMemos++
      continue
    }
    const input = {
      ...sample,
      content: typeof sample.content === 'function' ? sample.content(link) : sample.content,
      date: sample.date ?? null,
      dateEnd: sample.dateEnd ?? null,
    }
    const created = await request('POST', '/api/memos', input)
    if (typeof created?.id !== 'string') throw new Error('견본 메모 생성 응답이 올바르지 않습니다')
    memos.set(key, created)
    createdMemos++
  }
  return { createdFolders, createdMemos, skippedMemos }
}

async function main(args) {
  let url = DEFAULT_URL
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--url') throw new Error('사용법: node scripts/stage-demo/seed.mjs [--url <체험 환경 URL>]')
    url = args[1]
  }
  const result = await seedDemo({ url })
  console.log(`견본 준비 완료: 폴더 ${result.createdFolders}개·메모 ${result.createdMemos}개 추가, 기존 메모 ${result.skippedMemos}개 유지`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    // fetch 오류에 접속 정보나 서버 본문이 섞여도 출력하지 않는다.
    console.error('견본 준비 실패: 체험 환경 URL, 서버 상태와 로그인 설정을 확인하세요. 기존 데이터는 초기화하지 않았습니다.')
    process.exitCode = 1
  })
}
