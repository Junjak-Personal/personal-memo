# pic-blog Dockerfile 복제 (설계문서 §13). better-sqlite3 가 없어 빌드 툴체인과 네이티브 애드온 로드 검사는 뺐다.
#
# BuildKit 없이 빌드된다 (junserver 는 buildx 가 없고 DOCKER_BUILDKIT=0 고정).
# 그래서 --mount=type=cache / heredoc / COPY --link / --platform 을 일절 쓰지 않는다.
#
# Node 24 LTS 로 고정: 로컬 개발도 24 라 런타임이 같다. CI(deploy.yml)의 node-version 도 같이 바꾼다.

FROM node:24-slim AS build
WORKDIR /app

# 의존성 레이어를 소스와 분리한다. 소스만 바뀐 배포는 이 레이어를 캐시로 건너뛴다.
# nuxt.config.ts / tsconfig.json 은 postinstall 의 `nuxt prepare` 가 읽는다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml nuxt.config.ts tsconfig.json ./

# pnpm 버전은 package.json 의 packageManager 하나가 정한다 (로컬 corepack · CI 와 같은 값).
RUN npm i -g "$(node -p "require('./package.json').packageManager")"
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build


FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
# 컨테이너 내부는 0.0.0.0 으로 열어야 도커 포트 매핑이 닿는다.
# 바깥 노출 제한(127.0.0.1)은 docker run 의 포트 바인딩이 맡는다 — Cloudflare 터널만 들어온다.
ENV HOST=0.0.0.0
ENV PORT=4700
# memos/ 가 이 아래에 생긴다. 호스트 /home/junja/apps/personal-memo/data 가 여기 마운트된다.
ENV NUXT_DATA_DIR=/app/data

COPY --from=build /app/.output ./.output
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 루트로 시작해 볼륨 소유권만 맞추고 곧바로 node(uid 1000)로 내려간다 (엔트리포인트 주석 참조).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

EXPOSE 4700
CMD ["node", ".output/server/index.mjs"]
