(() => {
  const site = new URL(__MEMO_SITE__)
  if (location.protocol === 'tauri:' || location.origin === 'http://tauri.localhost') {
    document.addEventListener('DOMContentLoaded', () => {
      const link = document.getElementById('connect')
      const target = document.getElementById('target')
      if (link && target) {
        link.href = site.href
        target.textContent = site.href
      }
    }, { once: true })
    return
  }
  if (location.origin !== site.origin) return
  // 서버를 갱신하기 전 저장된 WebKit HTTP 캐시도 재사용하지 않는다.
  // URL·쿠키·본문·인증 처리는 기존 웹 그대로 두고 같은 출처 API의 캐시만 끈다.
  const fetch = window.fetch.bind(window)
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href)
    return fetch(input, url.origin === site.origin && url.pathname.startsWith('/api/')
      ? { ...options, cache: 'no-store' }
      : options)
  }
})()
