#!/bin/sh
# pic-blog 엔트리포인트 복제.
#
# 마운트된 볼륨(호스트 data/)은 호스트 계정 소유라, 처음 만든 폴더가 root 소유면 컨테이너 유저 node(uid 1000)가
# 쓰지 못한다 — 그대로 두면 첫 저장에서 EACCES 로 500 이 나고, 로그를 안 보면 코드 버그로 오인한다.
# 루트로 소유권만 맞춘 뒤 곧바로 node 로 내려간다.
#
# 🔴 N100 에서 vim 으로 고치는 junja 도 uid 1000 이라 이 chown 은 사람의 편집과 부딪히지 않는다 (설계문서 §13).
#    서버 사용자를 바꾸면 다시 확인한다.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p "${NUXT_DATA_DIR:-/app/data}/memos"
  chown -R node:node "${NUXT_DATA_DIR:-/app/data}"
  # setpriv 는 fork 없이 그대로 exec 한다 — node 가 PID 1 이 되어야 docker stop 의 SIGTERM 이 곧장 닿는다.
  # (runuser 는 fork 해서 root 가 PID 1 로 남는다)
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi

# 이미 비루트로 실행됐다면 그대로 간다
exec "$@"
