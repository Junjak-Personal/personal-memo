#!/usr/bin/env bash
# 검증된 운영 이미지를 별도 stage 컨테이너로 복제한다. 운영 컨테이너·데이터는 변경하지 않는다.
# 사용: ./scripts/deploy-stage.sh [junserver|junserver-ext]
set -euo pipefail

SSH_ALIAS="${1:-junserver}"
case "$SSH_ALIAS" in
  junserver|junserver-ext) ;;
  *) echo '중단: 대상은 junserver 또는 junserver-ext여야 합니다.' >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REVISION="$(git -C "$ROOT" rev-parse HEAD)"
STAGE_URL=https://memo-test.jun-devlog.win
RUNTIME_ENV="$(mktemp)"
trap 'rm -f "$RUNTIME_ENV"' EXIT

# 이미지의 revision이 이 checkout과 같은지 확인한 뒤, 이미지 ID로 고정한다.
ssh "$SSH_ALIAS" bash -s -- "$REVISION" <<'REMOTE'
set -euo pipefail
revision="$1"
image="$(docker inspect --format '{{.Image}}' personal-memo)"
actual="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
[ "$actual" = "$revision" ] || { echo '중단: 현재 운영 이미지와 checkout의 revision이 다릅니다.' >&2; exit 1; }

stage_dir="$HOME/apps/personal-memo-stage"
if [ -d "$stage_dir" ] && [ ! -f "$stage_dir/.memo-stage" ]; then
  echo '중단: stage 표시가 없는 기존 경로입니다.' >&2
  exit 1
fi
if docker container inspect personal-memo-stage >/dev/null 2>&1; then
  environment="$(docker inspect --format '{{index .Config.Labels "win.jundevlog.memo.environment"}}' personal-memo-stage)"
  [ "$environment" = stage ] || { echo '중단: 기존 컨테이너가 stage 소유가 아닙니다.' >&2; exit 1; }
elif [ -n "$(ss -H -ltn 'sport = :4701')" ]; then
  echo '중단: 4701 포트를 다른 프로세스가 사용합니다.' >&2
  exit 1
fi
mkdir -p "$stage_dir/data"
touch "$stage_dir/.memo-stage"
docker image tag "$image" personal-memo:stage
echo "stage 이미지 revision: $actual"
REMOTE

# memo-demo는 README에 공개하는 체험용 비밀번호다. 운영 인증정보를 읽지 않는다.
# 임시 파일에는 새 세션 키와 해시만 넣고, 값을 출력하지 않는다.
(
  cd "$ROOT"
  node --input-type=module - "$RUNTIME_ENV" <<'NODE'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Hash } from '@adonisjs/hash'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'

const config = {
  NUXT_SESSION_PASSWORD: randomBytes(48).toString('hex'),
  NUXT_SESSION_NAME: 'memo-stage-session',
  NUXT_ADMIN_PASSWORD_HASH: await new Hash(new Scrypt({})).make('memo-demo'),
  NUXT_SITE_URL: 'https://memo-test.jun-devlog.win',
  NUXT_DATA_DIR: '/app/data',
  NUXT_GOOGLE_CALENDAR_ID: '',
  NUXT_GOOGLE_SERVICE_ACCOUNT: '',
  NUXT_GOOGLE_SERVICE_ACCOUNT_FILE: '',
}
await writeFile(process.argv[2], Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 })
NODE
)
scp -q "$RUNTIME_ENV" "$SSH_ALIAS:apps/personal-memo-stage/.env.runtime"

ssh "$SSH_ALIAS" bash -s <<'REMOTE'
set -euo pipefail
stage_dir="$HOME/apps/personal-memo-stage"
chmod 600 "$stage_dir/.env.runtime"
docker rm -f personal-memo-stage >/dev/null 2>&1 || true
docker run -d \
  --name personal-memo-stage \
  --label win.jundevlog.memo.environment=stage \
  --restart unless-stopped \
  --env-file "$stage_dir/.env.runtime" \
  -v "$stage_dir/data:/app/data" \
  -p 127.0.0.1:4701:4700 \
  personal-memo:stage >/dev/null

for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:4701/api/health >/dev/null; then
    echo 'stage localhost:4701 헬스체크 통과'
    exit 0
  fi
  sleep 2
done
echo 'stage 헬스체크 실패. 운영 컨테이너는 변경하지 않았습니다.' >&2
exit 1
REMOTE

curl --fail --silent --show-error --max-time 15 "$STAGE_URL/api/health" >/dev/null
echo "stage 외부 헬스체크 통과: $STAGE_URL"
MEMO_STAGE_PASSWORD=memo-demo node "$ROOT/scripts/stage-demo/seed.mjs" --url "$STAGE_URL"
