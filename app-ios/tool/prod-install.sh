#!/usr/bin/env bash
# 운영 서버를 보는 「memo」를 설치한다. 개발용과 같은 빌드·검증 순서를 쓰되 App Group 없이는 설치하지 않는다.
set -euo pipefail

exec "$(dirname "$0")/dev-install.sh" --production
