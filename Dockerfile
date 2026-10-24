# ACESOUND — 서버(API + 봇) + Activity 정적 파일을 하나의 이미지로
# ARM(Oracle Ampere)·x86 모두 빌드 가능

FROM node:22-bookworm-slim AS build
WORKDIR /app

# 의존성 먼저 (캐시 활용)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .

# Activity 빌드에 Client ID가 들어갑니다 (공개 값)
ARG VITE_DISCORD_CLIENT_ID
RUN test -n "$VITE_DISCORD_CLIENT_ID" || (echo "VITE_DISCORD_CLIENT_ID 빌드 인자가 비어 있습니다" && exit 1)
RUN npm run build && npm prune --omit=dev


FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
