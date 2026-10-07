export default defineNuxtConfig({
  compatibilityDate: '2026-10-06',
  devtools: { enabled: false },
  /*
   * SPA. 전부 로그인 뒤에 있는 개인 앱이라 서버 렌더로 얻는 것(첫 화면 속도·검색 노출·링크 미리보기)이 없다.
   * 서버 렌더를 켜면 Tiptap 이 vite-node 쪽과 Node 쪽에 prosemirror-state 를 두 벌 올려
   * 「Adding different instances of a keyed plugin (plugin$)」 로 500 이 난다 (스파이크 S2 에서 실측).
   */
  ssr: false,
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  // 글꼴은 Pretendard CDN 하나뿐이다. @nuxt/fonts 가 font-sans 이름으로 외부 공급자를 뒤지지 않게 끈다
  ui: { fonts: false },
  /*
   * 아이콘은 이 앱 안에서만 — 외부 API 를 부르지 않는다.
   * 🔴 SPA(ssr: false)면 Nuxt Icon 의 기본 공급원이 api.iconify.design 이라, 화면을 그릴 때마다 외부에서
   *    아이콘을 받아오고 있었다. 게다가 그 API 는 ⌃ 를 「⌄ + 뒤집기」로 압축해 보내는데 CSS 아이콘이 뒤집기를
   *    빼먹어 폴더 화살표가 늘 ⌄ 로 그려졌다 (2026-10-07). 쓰는 아이콘을 스캔해 번들에 넣고(.ts 포함 —
   *    에디터 메뉴 아이콘이 items.ts 에 있다), 나머지는 로컬 @iconify-json 으로 서버가 준다.
   */
  icon: {
    provider: 'server',
    fallbackToApi: false,
    serverBundle: 'local',
    clientBundle: {
      scan: { globInclude: ['app/**/*.{vue,ts}'], globExclude: ['node_modules', '.nuxt', '.output'] },
      sizeLimitKb: 512,
    },
  },
  // 라우트 컴포넌트 옆의 _modules/ 는 페이지가 아니다 (전역 규칙: 라우트는 얇게, 로직은 _modules)
  ignore: ['pages/**/_modules/**'],
  app: {
    // 화면 사이 이동 — 짧은 페이드 (main.css 의 .page-*)
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      title: 'memo',
      htmlAttrs: { lang: 'ko' },
      link: [
        { rel: 'icon', type: 'image/png', sizes: '64x64', href: '/favicon.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        { rel: 'preconnect', href: 'https://cdn.jsdelivr.net', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css',
        },
      ],
      meta: [
        /*
         * 확대·축소를 막는다 (앱처럼 쓰기 위한 요청). maximum-scale=1 은 입력칸을 눌렀을 때 아이폰이 저절로
         * 확대하는 것도 막는다. 사파리는 user-scalable=no 를 무시하므로 plugins/no-pinch-zoom.client.ts 가 더 막는다.
         * viewport-fit=cover 가 없으면 env(safe-area-inset-*) 가 전부 0 이다 (pic-blog 와 같은 이유).
         */
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
        },
      ],
    },
  },
  // pic-blog 가 4600 을 쓴다
  devServer: { port: 4700, host: 'localhost' },
  runtimeConfig: {
    /** memos/ 가 이 아래에 생긴다. 운영은 고정 경로를 볼륨으로 붙인다 (설계문서 §13) */
    dataDir: './data',
    /** 비밀번호 scrypt 해시 — 평문 금지. node scripts/hash-password.mjs */
    adminPasswordHash: '',
    /** 이 앱의 바깥 주소 (`https://memo.example.com`). 구글 일정 설명에 메모 링크로 넣는다. 비우면 링크 없음 */
    siteUrl: '',
    /**
     * 구글 캘린더 연동 (설계문서 §8). 캘린더 ID 와 키(둘 중 하나)가 다 있어야 켜진다 — 없으면 꺼진다.
     * 🔴 개발에서 운영과 같은 캘린더를 켜지 않는다. 대조는 «이 서버가 모르는 memoId» 일정을 지우므로
     *    두 서버가 한 캘린더를 나눠 쓰면 서로의 일정을 지운다.
     */
    google: {
      calendarId: '',
      /** 서비스 계정 키 JSON 을 base64 로 — 운영(.env.prd) */
      serviceAccount: '',
      /** 서비스 계정 키 파일 경로 — 개발 */
      serviceAccountFile: '',
    },
    session: {
      name: 'memo-session',
      password: '',
      /*
       * 🔴 이 값이 없으면 쿠키에 Expires 가 안 붙어 브라우저 세션 쿠키가 되고, 폰에서 앱이 메모리에서
       *    내려갈 때마다 다시 로그인해야 한다 (pic-blog 에서 겪었다). 만료는 로그인 시각 기준 절대 30일.
       */
      maxAge: 60 * 60 * 24 * 30,
      cookie: {
        /*
         * 개발일 때만 Secure 를 푼다. 폰의 개발용 껍데기는 http://맥이름.local 로 붙는데,
         * Secure 쿠키는 신뢰 출처에만 저장돼 로그인이 200 이어도 쿠키가 버려진다.
         * 값은 빌드 시점에 굳고 nuxt build 는 NODE_ENV=production 이라 운영은 언제나 true.
         */
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },
  experimental: {
    // 화면 코드를 못 받았을 때 페이지를 통째로 다시 부르지 않는다 — 오프라인이면 쓰던 화면을 잃는다 (plugins/route-chunk-error.client.ts)
    emitRouteChunkError: 'manual',
  },
  typescript: { strict: true, typeCheck: false },
})
