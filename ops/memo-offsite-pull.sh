#!/usr/bin/env bash
#
# 오프사이트 백업 — N100 의 메모 백업을 이 맥으로 당긴다. launchd 로 매일 돈다 (nivoca-offsite-pull.sh 와 같은 구조).
#
# ⚠ 이 스크립트는 박스가 아니라 **맥에서** 돈다. 박스 쪽은 memo-backup.sh 다.
#
# 왜 PULL 인가: 박스가 털렸을 때 push 였다면 공격자가 백업 목적지에도 닿는다. 당기는 방향이면 맥의 자격증명이
# 박스에 없으므로 사본이 남는다.
# 왜 rsync 가 아닌가: N100 에 rsync 가 없다 (nivoca 실측). 백업은 불변이고 파일명이 초 단위 타임스탬프라
# 「로컬에 없는 것만 scp」로 충분하다.
#
# 로컬 보존(60일)이 박스(14일)보다 긴 것은 의도적이다. 같은 이유로 삭제를 동기화하지 않는다.
set -euo pipefail

HOST="${MEMO_BACKUP_HOST:-junserver-ext}"
SRC="${MEMO_BACKUP_REMOTE_DIR:-backups/memo}"
DEST="${MEMO_OFFSITE_DIR:-$HOME/memo-backups}"
KEEP_DAYS="${MEMO_OFFSITE_KEEP_DAYS:-60}"

mkdir -p "$DEST"
chmod 700 "$DEST"   # 개인 메모 전부다.

# BatchMode: launchd 에는 물어볼 사람이 없다. 프롬프트가 뜨면 무한정 매달리는 대신 실패한다.
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)

remote_list=$(ssh "${SSH_OPTS[@]}" "$HOST" "ls -1 $SRC/memo-*.tar.gz 2>/dev/null" || true)
if [ -z "$remote_list" ]; then
  echo "✗ 원격에 백업이 없다 ($HOST:$SRC) — 박스 타이머가 죽었는지 확인할 것" >&2
  exit 1
fi

pulled=0
skipped=0
while IFS= read -r rf; do
  [ -n "$rf" ] || continue
  base=$(basename "$rf")
  if [ -f "$DEST/$base" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  tmp="$DEST/$base.partial"
  scp -q "${SSH_OPTS[@]}" "$HOST:$rf" "$tmp"
  # 받은 것이 온전한지 여기서 본다. 깨진 사본을 완성된 백업처럼 두는 것이 백업이 없는 것보다 나쁘다.
  if ! gzip -t "$tmp" 2>/dev/null; then
    echo "✗ $base — 전송본이 깨졌다, 버린다" >&2
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "$DEST/$base"
  chmod 600 "$DEST/$base"
  echo "  ↓ $base"
  pulled=$((pulled + 1))
done <<< "$remote_list"

echo "✔ $(date '+%F %T') 오프사이트 동기화 — 신규 $pulled, 기존 $skipped, 보관 $(ls -1 "$DEST"/memo-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')건"

# 로테이션은 마지막에, 성공한 뒤에만.
find "$DEST" -name 'memo-*.tar.gz' -type f -mtime "+$KEEP_DAYS" -print -delete
find "$DEST" -name 'memo-*.tar.gz.partial' -type f -mtime +1 -delete
