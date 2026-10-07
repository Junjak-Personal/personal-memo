#!/usr/bin/env bash
#
# 폰에 «개발용» 껍데기를 설치한다 — 맥의 dev 서버를 바라본다. (pic-blog app-ios/tool/dev-install.sh 복제)
#
# 운영용(win.jundevlog.memo)과 번들 id 가 달라 두 앱이 나란히 산다: 「memo」 / 「memo dev」.
#
#   사용:  pnpm dev --host 0.0.0.0   (맥에서 먼저 띄운다)
#          app-ios/tool/dev-install.sh
#          PAGE=/spike/mobile app-ios/tool/dev-install.sh   (특정 화면으로 시작)
#
# 🔴 맥은 «이름.local» 이 아니라 와이파이 IP 로 부른다.
#    이 집 공유기/통신사 DNS 가 없는 이름에 218.38.137.27 을 답한다 (2026-10-07 실측, dns-sd 로 확인).
#    Bonjour 는 192.168.0.72 를 맞게 답하지만 폰이 DNS 답을 먼저 받으면 엉뚱한 곳에 붙어 흰 화면으로 멈춘다.
#    IP 로 부르면 ATS 예외도 필요 없다 — iOS 10 이후 ATS 는 IP 주소 연결에 적용되지 않는다
#    (Apple DTS: https://developer.apple.com/forums/thread/66417). pic-blog 의 같은 스크립트에 있던
#    「사설 IP 는 예외에 들지 않는다」는 주석은 틀렸다.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-4700}"
HOST="${HOST:-$(ipconfig getifaddr en0)}"
ORIGIN="http://${HOST}:${PORT}"
SITE="${SITE:-${ORIGIN}${PAGE:-}}"
BUNDLE_ID="${BUNDLE_ID:-win.jundevlog.memo.dev}"
APP_NAME="${APP_NAME:-memo dev}"

echo "▸ 대상   $SITE"
echo "▸ 번들   $BUNDLE_ID  («${APP_NAME}»)"

# dev 서버가 실제로 살아 있는지 먼저 본다 — 안 그러면 앱이 빈 화면으로 뜨고 이유를 모른다.
#
# 폰이 붙을 그 주소(와이파이 IP)로 확인한다 — dev 서버가 --host 0.0.0.0 으로 떠 있어야 닿는다.
if ! curl -fsS -o /dev/null --max-time 5 "${ORIGIN}/api/health"; then
  echo "✗ ${ORIGIN} 이 응답하지 않습니다. 맥에서 먼저: pnpm dev --host 0.0.0.0" >&2
  exit 1
fi

# 🔴 열 위치로 자르면 안 된다 — 기기 이름에 공백이 있어 열이 밀린다. UUID 모양으로 찾는다.
#    상태는 «available (paired)» 이거나 «connected» 다 (케이블 연결 여부에 따라 바뀐다).
DEVICE="${DEVICE:-$(xcrun devicectl list devices 2>/dev/null \
  | awk '/iPhone/ && /available|connected/ && !/simulated/ {
      for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-/ || $i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; exit }
    }')}"
if [ -z "$DEVICE" ]; then
  echo "✗ 연결된 아이폰을 못 찾았습니다. xcrun devicectl list devices 로 확인하세요." >&2
  exit 1
fi
echo "▸ 기기   $DEVICE"

# 1) Dart 쪽 define 과 Xcode 설정만 만든다 (--config-only 는 빌드하지 않는다)
flutter build ios --release --config-only --dart-define="SITE=$SITE"

# 2) 번들 id·이름은 여기서 덮어쓴다. -allowProvisioningUpdates 가 새 번들 id 의 프로파일을 만든다.
build() {
  xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner \
    -configuration Release -destination "generic/platform=iOS" \
    -derivedDataPath build/dev-dd \
    -allowProvisioningUpdates \
    APP_BUNDLE_ID="$BUNDLE_ID" \
    APP_DISPLAY_NAME="$APP_NAME" \
    "$@" \
    build
}

# 🔴 공유 시트(MemoShare)는 App Group 이 있어야 앱과 보관함을 나눠 쓴다. App Group 은 와일드카드 프로파일로는 서명이
#    안 되고, Xcode 에 Apple ID 가 로그인돼 있어야 -allowProvisioningUpdates 가 App ID·그룹·프로파일을 만든다
#    (2026-10-07: Xcode 에 계정이 없어 「No Accounts」 로 실패). 그때는 App Group 을 빼고 설치한다 —
#    공유 시트는 「보관하지 못했습니다」 를 띄우고 나머지는 그대로 된다. 조용히 넘어가지 않게 끝에 크게 알린다.
NO_GROUP=""
if ! build; then
  echo "⚠ App Group 서명에 실패했습니다 — App Group 없이 다시 빌드합니다 (공유 시트는 이 설치에서 동작하지 않음)" >&2
  build CODE_SIGN_ENTITLEMENTS=NoAppGroup.entitlements APP_GROUP_ID=
  NO_GROUP=1
fi

APP="build/dev-dd/Build/Products/Release-iphoneos/Runner.app"
[ -d "$APP" ] || { echo "✗ 빌드 산출물이 없습니다: $APP" >&2; exit 1; }

# 심어진 값이 의도대로인지 확인하고 넘어간다 — 잘못된 대상을 조용히 설치하지 않는다
echo "▸ 확인   id=$(defaults read "$PWD/$APP/Info" CFBundleIdentifier)  이름=$(defaults read "$PWD/$APP/Info" CFBundleDisplayName)"
if grep -rl --binary-files=text -F "$SITE" "$APP" >/dev/null 2>&1; then
  echo "▸ 확인   번들 안에 $SITE 가 들어 있습니다"
else
  echo "✗ 번들에 $SITE 가 없습니다 — 엉뚱한 대상을 설치할 뻔했습니다" >&2
  exit 1
fi

xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "✓ 설치 완료 — 홈 화면의 «${APP_NAME}» 을 여세요"
if [ -n "$NO_GROUP" ]; then
  echo "⚠ 공유 시트 없이 설치했습니다. Xcode → Settings → Accounts 에 Apple ID 를 넣고 다시 실행하면 같이 설치됩니다." >&2
fi
