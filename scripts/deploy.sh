#!/usr/bin/env bash
# junserver 배포 — 맥에서 직접 (pic-blog scripts/deploy.sh 복제, 설계문서 §13).
# main 에 push 하면 GitHub Actions(.github/workflows/deploy.yml)도 같은 일을 한다. 둘 중 하나만 쓰면 된다.
#
# 이미지는 **서버에서** 빌드한다 — 맥은 arm64, junserver 는 x86_64 이고 buildx 가 없다.
# compose 를 쓰지 않는다: junserver 의 기존 서비스가 전부 평범한 `docker run` 으로 돈다. 그 관례에 맞춘다.
#
#   ./scripts/deploy.sh                # LAN
#   ./scripts/deploy.sh junserver-ext  # 집 밖
#
# 바깥 주소: Cloudflare 터널(junserver 쪽, 대시보드 관리형) memo.jun-devlog.win → http://localhost:4700
set -euo pipefail

SSH_ALIAS="${1:-junserver}"
REMOTE_DIR="${REMOTE_DIR:-apps/personal-memo}" # ssh 로그인 홈 기준 상대경로 → /home/junja/apps/personal-memo
CONTAINER="${CONTAINER:-personal-memo}"
IMAGE="${IMAGE:-personal-memo:prd}"
PORT=4700
HEALTH_URL="${HEALTH_URL:-https://memo.jun-devlog.win/api/health}"

# junserver 에는 buildx 가 없다. 로컬에서 무심코 BuildKit 문법을 검증하는 일도 막는다.
export DOCKER_BUILDKIT=0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.prd"

# ── 1) 시크릿 사전 검사 ────────────────────────────────────────────────
# 뜬 다음 500 으로 알게 되는 것보다 배포를 시작조차 안 하는 편이 싸다. 값은 출력하지 않는다.
[ -f "$ENV_FILE" ] || {
  echo "중단: $ENV_FILE 가 없다. .env.example 을 보고 만든다." >&2
  exit 1
}

value_of() {
  # grep 이 못 찾으면 pipefail 로 스크립트가 죽으므로 || true 로 받아 빈 값으로 떨어뜨린다.
  grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -E "s/^'(.*)'$/\1/" || true
}

for key in NUXT_SESSION_PASSWORD NUXT_ADMIN_PASSWORD_HASH NUXT_SITE_URL; do
  [ -n "$(value_of "$key")" ] || {
    echo "중단: .env.prd 의 $key 가 비어 있다." >&2
    exit 1
  }
done
# nuxt-auth-utils 는 32자 미만 세션 키를 런타임에 거부한다 — 여기서 먼저 걸러낸다.
session="$(value_of NUXT_SESSION_PASSWORD)"
[ "${#session}" -ge 32 ] || {
  echo "중단: NUXT_SESSION_PASSWORD 가 32자 미만이다 (openssl rand -base64 32)." >&2
  exit 1
}
case "$(value_of NUXT_ADMIN_PASSWORD_HASH)" in
  '$scrypt$'*) ;;
  *)
    echo "중단: NUXT_ADMIN_PASSWORD_HASH 가 scrypt 해시 형식이 아니다 (평문을 넣지 않았는지 확인)." >&2
    echo "      printf '%s' '<비밀번호>' | node scripts/hash-password.mjs" >&2
    exit 1
    ;;
esac
case "$(value_of NUXT_SITE_URL)" in
  https://*) ;;
  *)
    echo "중단: NUXT_SITE_URL 은 https:// 로 시작해야 한다 (구글 일정 설명의 메모 링크)." >&2
    exit 1
    ;;
esac

# 개발 전용 키가 운영에 섞이지 않게 — 평문 비밀번호, 맥의 키 파일 경로(컨테이너에는 없다)
for key in E2E_PASSWORD NUXT_GOOGLE_SERVICE_ACCOUNT_FILE; do
  [ -z "$(value_of "$key")" ] || {
    echo "중단: .env.prd 에 개발 전용 $key 가 있다. 지운다." >&2
    exit 1
  }
done

# 구글 연동은 캘린더 ID 와 키가 둘 다 있어야 켜진다 (설계문서 §8). 하나만 있으면 조용히 꺼지므로 막는다.
calendar="$(value_of NUXT_GOOGLE_CALENDAR_ID)"
account="$(value_of NUXT_GOOGLE_SERVICE_ACCOUNT)"
if [ -n "$calendar" ] && [ -n "$account" ]; then
  echo "구글 캘린더 연동: 켬"
elif [ -z "$calendar" ] && [ -z "$account" ]; then
  echo "⚠ 구글 캘린더 연동: 끔 (NUXT_GOOGLE_CALENDAR_ID·NUXT_GOOGLE_SERVICE_ACCOUNT 없음)" >&2
else
  echo "중단: NUXT_GOOGLE_CALENDAR_ID 와 NUXT_GOOGLE_SERVICE_ACCOUNT 는 둘 다 넣거나 둘 다 비운다." >&2
  exit 1
fi

# docker --env-file 은 따옴표를 값의 일부로 읽는다 (compose 와 다르다).
# 그래서 전송 직전에 작은따옴표를 벗겨 서버용 env 파일을 만든다.
RUNTIME_ENV="$(mktemp)"
trap 'rm -f "$RUNTIME_ENV"' EXIT
sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'$/\1=\2/" "$ENV_FILE" > "$RUNTIME_ENV"

# 벗긴 값이 실제로 온전한지 확인한다 — 해시가 깨지면 로그인이 항상 실패한다.
grep -qE "^NUXT_ADMIN_PASSWORD_HASH=\\\$scrypt\\\$" "$RUNTIME_ENV" || {
  echo "중단: 서버용 env 에서 NUXT_ADMIN_PASSWORD_HASH 가 깨졌다." >&2
  exit 1
}

# ── 2) 소스 전송 ──────────────────────────────────────────────────────
ssh "$SSH_ALIAS" "mkdir -p '$REMOTE_DIR/data'"

# data/ 는 --exclude 라서 --delete 대상에서도 빠진다 → 서버의 메모·이미지는 보존된다.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.nuxt' \
  --exclude '.output' \
  --exclude 'data' \
  --exclude 'app-ios' \
  --exclude '_workspace' \
  --exclude '_docs' \
  --exclude '.claude' \
  --exclude '.playwright-mcp' \
  --exclude '.env*' \
  --exclude '.DS_Store' \
  "$ROOT/" "$SSH_ALIAS:$REMOTE_DIR/"

# 시크릿은 rsync 에서 제외했다 (로컬이 SSOT). 명시적으로만 올린다.
scp -q "$RUNTIME_ENV" "$SSH_ALIAS:$REMOTE_DIR/.env.runtime"
ssh "$SSH_ALIAS" "chmod 600 '$REMOTE_DIR/.env.runtime'"

# ── 3) 서버에서 빌드 + 기동 ───────────────────────────────────────────
# 기존 컨테이너를 지우기 전에 빌드한다 — 빌드가 깨지면 돌던 서비스를 살려둔다.
ssh "$SSH_ALIAS" "cd '$REMOTE_DIR' && DOCKER_BUILDKIT=0 docker build -t '$IMAGE' ."

ssh "$SSH_ALIAS" "
  set -e
  cd '$REMOTE_DIR'
  docker rm -f '$CONTAINER' >/dev/null 2>&1 || true
  docker run -d \
    --name '$CONTAINER' \
    --restart unless-stopped \
    --env-file .env.runtime \
    -e NUXT_DATA_DIR=/app/data \
    -v \"\$PWD/data:/app/data\" \
    -p 127.0.0.1:$PORT:$PORT \
    '$IMAGE'
"

# ── 4) 검증 ──────────────────────────────────────────────────────────
# 컨테이너 안에서 먼저 확인한다 — 여기서 실패하면 터널 문제가 아니다.
echo "컨테이너 헬스체크…"
for _ in $(seq 1 15); do
  if ssh "$SSH_ALIAS" "curl -sf http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "  로컬 200: $(ssh "$SSH_ALIAS" "curl -sf http://127.0.0.1:$PORT/api/health")"
    break
  fi
  sleep 3
done

echo "터널 헬스체크…"
for _ in $(seq 1 15); do
  if curl -sf "$HEALTH_URL" >/dev/null; then
    echo "배포 성공: $(curl -sf "$HEALTH_URL")"
    ssh "$SSH_ALIAS" "docker logs --tail=5 '$CONTAINER'"
    exit 0
  fi
  sleep 4
done

echo "실패: $HEALTH_URL 이 약 60초 동안 200 을 주지 않았다." >&2
echo "  컨테이너: ssh $SSH_ALIAS 'docker logs --tail=50 $CONTAINER'" >&2
echo "  터널:     ssh $SSH_ALIAS 'journalctl -u cloudflared -n 50'" >&2
exit 1
