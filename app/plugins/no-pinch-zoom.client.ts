/**
 * 두 손가락 확대를 막는다 (앱처럼 쓰기 위한 요청 — pic-blog 의 같은 플러그인을 옮겼다).
 *
 * viewport 의 user-scalable=no 만으로는 부족하다 — iOS 사파리는 접근성 이유로 그걸 무시한다.
 * 껍데기(WKWebView)에서는 먹지만, 사파리로 열면 확대가 그대로 남아 화면마다 동작이 갈린다.
 * gesturestart/change/end 는 iOS 전용 이벤트이고 페이지 확대 제스처가 여기로 온다.
 */
export default defineNuxtPlugin(() => {
  const block = (e: Event) => e.preventDefault()
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, block, { passive: false })
  }
})
