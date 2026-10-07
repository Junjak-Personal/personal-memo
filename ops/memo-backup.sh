#!/usr/bin/env bash
#
# 메모 백업 — N100 에서 systemd timer 로 매일 돈다 (설계문서 §12, nivoca be/ops/nivoca-backup.sh 와 같은 구조).
#
# 메모는 DB 가 아니라 파일이라 pg_dump 대신 tar 다. 원본 = /home/junja/apps/personal-memo/data/memos.
#   - 넣는 것: 모든 .md (휴지통 .trash 포함), 폴더 구조, assets/ 밖의 다른 파일
#   - 빼는 것: assets/ 안의 이미지·원본 (확정: 이미지는 백업하지 않는다 — 복원하면 본문 속 이미지 링크는 깨진 채 남는다)
#
# 검증: gzip 무결성 + «아카이브 안 .md 개수 = 직전에 센 디스크 .md 개수». 다르면(백업 도중 메모가 생기거나 지워짐)
#       한 번 다시 뜬 뒤에도 다르면 실패한다.
#
# ⚠ 이 스크립트는 읽기 전용이다. 메모를 고치지 않고, 지우는 것은 자기가 만든 오래된 백업뿐이다.
set -euo pipefail

DATA="${MEMO_DATA_DIR:-/home/junja/apps/personal-memo/data}"
DEST="${MEMO_BACKUP_DIR:-/home/junja/backups/memo}"
KEEP_DAYS="${MEMO_BACKUP_KEEP_DAYS:-14}"

[ -d "$DATA/memos" ] || { echo "✗ 메모 폴더가 없다: $DATA/memos" >&2; exit 1; }

mkdir -p "$DEST"
# 그룹/기타 권한 제거: 개인 메모 전부다.
chmod 700 "$DEST"

count_disk() {
  find "$DATA/memos" -type f -name '*.md' | wc -l | tr -d ' '
}

count_archive() {
  # ⚠ `grep -c` 를 쓰지 않는다 — 0건이면 종료코드 1 이라 pipefail 과 만나 «0건» 이 «실패» 가 된다.
  tar -tzf "$1" | awk '/\.md$/ { n++ } END { print n + 0 }'
}

backup_once() {
  local tmp="$1"
  # assets/ 아래에서 .md 가 아닌 것만 건너뛰고 나머지(폴더 포함)를 하나씩 넣는다. --no-recursion 이 없으면
  # 목록의 폴더를 tar 가 통째로 다시 훑어 이미지까지 들어간다.
  # 폴더 이름이 assets 인 사용자 폴더의 .md 는 들어간다 — 개수 대조가 그것까지 센다.
  (cd "$DATA" && find memos \( -path '*/assets/*' ! -name '*.md' \) -prune -o -print0) \
    | tar -C "$DATA" --null --no-recursion -T - -czf "$tmp"
}

stamp=$(date +%Y%m%d-%H%M%S)
out="$DEST/memo-${stamp}.tar.gz"
tmp="$out.partial"

ok=""
for attempt in 1 2; do
  expected=$(count_disk)
  backup_once "$tmp"
  gzip -t "$tmp"
  actual=$(count_archive "$tmp")
  if [ "$actual" = "$expected" ]; then
    ok=1
    break
  fi
  echo "⚠ ${attempt}번째: 아카이브 .md ${actual}개 ≠ 디스크 ${expected}개 (백업 중 메모가 바뀌었을 수 있다)" >&2
  rm -f "$tmp"
done
[ -n "$ok" ] || { echo "✗ 두 번 모두 .md 개수가 맞지 않았다 — 실패로 처리" >&2; exit 1; }

# 메모가 0개인 것도 정상일 수 있다(처음 배포 직후). 다만 눈에 띄게 남긴다.
[ "$expected" -gt 0 ] || echo "⚠ 메모가 0개다 — 첫 배포 직후가 아니면 데이터 폴더를 확인할 것" >&2

# 검증을 통과한 뒤에야 최종 이름을 준다. 중간에 죽으면 .partial 로 남아 성공한 백업으로 오인되지 않는다.
mv "$tmp" "$out"
chmod 600 "$out"
echo "✔ $out (.md ${expected}개, $(du -h "$out" | cut -f1))"

# 로테이션은 마지막에. 새 백업이 검증을 통과한 뒤에만 옛것을 지운다.
find "$DEST" -name 'memo-*.tar.gz' -type f -mtime "+$KEEP_DAYS" -print -delete
# 실패해서 남은 .partial 도 같이 청소 (하루 넘은 것만).
find "$DEST" -name 'memo-*.tar.gz.partial' -type f -mtime +1 -delete
