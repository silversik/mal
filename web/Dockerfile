# syntax=docker/dockerfile:1.6
# mal.kr web (Next.js 16 standalone).  Build context = ./web (서브디렉터리)

# ── deps ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── build ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js 16 Turbopack 빌드는 page-data 수집 단계에서 서버 라우트를 import 하므로
# DATABASE_URL 이 없으면 터진다. lib/db.ts 의 lazy init 이 처리하지만,
# 안전을 위해 빌드 시에만 쓰는 placeholder 를 주입.
ENV DATABASE_URL="postgresql://build-dummy:dummy@localhost:5432/build-dummy"
RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
