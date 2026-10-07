# Deployment

> pic-blog 의 배포를 복제했다. SSOT: 설계문서 §13.

## 대상
- 서버: junserver (N100, x86_64). 기존 서비스가 전부 평범한 `docker run` — compose 없음, buildx 없음(`DOCKER_BUILDKIT=0`).
- 컨테이너 `personal-memo`, 이미지 `personal-memo:prd`, `-p 127.0.0.1:4700:4700`, `--restart unless-stopped`.
- 데이터: `/home/junja/apps/personal-memo/data` → `/app/data` (memos/ 가 그 아래). 러너 작업공간 아래에 두지 않는다.
- 바깥 주소: Cloudflare 터널(junserver 쪽, 대시보드 관리형) `memo.jun-devlog.win → http://localhost:4700`.
  🔴 raspi 터널에 넣으면 localhost 가 raspi 를 가리킨다. 터널 삭제(`cloudflared tunnel delete`) 금지 — raspi 와 공유물.

## 배포 경로 (둘 중 하나)
| 경로 | 시크릿 출처 | 하는 일 |
|---|---|---|
| `scripts/deploy.sh [junserver\|junserver-ext]` (맥) | `.env.prd` (gitignore) | 사전 검사 → rsync(data·app-ios 제외) → 서버에서 빌드 → 교체 → 로컬·터널 헬스체크 |
| `.github/workflows/deploy.yml` (main push) | GitHub secrets/vars (`production` 환경) | ubuntu 에서 typecheck·test·build → `[self-hosted, n100]` 러너에서 빌드 → 교체 → 헬스체크 |

- 시크릿: `NUXT_SESSION_PASSWORD`(32자+), `NUXT_ADMIN_PASSWORD_HASH`(`$scrypt$…`), `NUXT_GOOGLE_SERVICE_ACCOUNT`(키 JSON base64).
  vars: `NUXT_SITE_URL`(https), `NUXT_GOOGLE_CALENDAR_ID`. 구글 둘은 함께 넣거나 함께 비운다.
- `.env.prd` 에 `E2E_PASSWORD`·`NUXT_GOOGLE_SERVICE_ACCOUNT_FILE` 이 있으면 deploy.sh 가 멈춘다 (개발 전용).
- 이미지: `node:24-slim` 2단계. 런타임은 `.output` 만 — 엔트리포인트가 볼륨을 node(uid 1000)로 chown 후 setpriv 로 내려간다.

## 검증 (2026-10-07)
- `.dockerignore` 를 적용한 컨텍스트에서 install·build, `.output` 만 둔 폴더(node_modules 없음)에서 운영 모드 API 스모크 13/13.
- base64 키 경로: 존재하지 않는 캘린더로 띄워 구글 인증 통과 → 404 확인 (실제 캘린더 미접촉).
- 이미지 빌드 자체는 맥에서 못 돌렸다(Docker 데몬 꺼짐) — 첫 배포 때 서버에서 처음 빌드된다.
