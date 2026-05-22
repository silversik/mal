# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

`mal.kr` — 한국마사회(KRA) 공공데이터 기반 경마 데이터 아카이빙 + 분석 + **비현금성** 모의배팅. 데이터 소스: KRA OpenAPI (data.go.kr) · 기상청 ASOS · 네이버 검색 · YouTube Data v3.

## 스택 한 줄

`web/` Next.js 16 (App Router · NextAuth v5 Kakao · Server Actions) · `crawler/` Python (httpx + Tenacity + SQLAlchemy + APScheduler + `crawler_core`) · `db/migrations/` PostgreSQL (`mal` schema in 공용 `app` DB) · `docker/` 로컬 dev compose.

## 자주 쓰는 명령

```bash
# 로컬 Postgres 띄우기 (마이그레이션 자동 적용)
cd docker && cp .env.example .env && docker compose up -d

# Web
cd web && npm install && npm run dev          # :3000
npm run lint && npx tsc --noEmit              # Jenkins 가 둘 다 수행 (lint non-blocking)

# Crawler — 한 잡 단위 테스트
cd crawler && uv run python -m mal_crawler.jobs.sync_races_today
uv run python -m mal_crawler.jobs.sync_races_live --dry-run
```

마이그레이션은 Jenkins `Migrate` stage 가 자동 적용 (`db/migrations/run-migrations.sh`, `_migrations_applied` 테이블로 idempotent).

## 절대 어기지 말 것

1. **owner / nickname 컬럼은 추가만, drop 금지** — prod 500이 두 번 났고 그 때문에 Migrate 스테이지 자동화가 도입됨. drop이 필요하면 새 마이그레이션으로 NULL-허용으로 만들고, 코드에서 사용 중단된 후에야 drop. 동일 마이그레이션 안에서 add+drop 금지.
2. **KRA OpenAPI key는 IP 화이트리스트 + 분당 호출 한도**. 로컬에서 prod key 쓰면 prod 잡이 라인업·날씨 fetch 미스. 로컬 테스트는 dev key 또는 fixture replay.
3. **`web/.env.local` 의 `DATABASE_URL` 은 `localhost:5432` (로컬 stack-db 컨테이너) 만**. 옛 컨벤션은 prod 49.50.138.31:5432 직접 접속이었지만 2026-04-30 세션에서 로컬 컨테이너 전환됨 (ops HANDOVER §22 참고). 운영 DB 직접 connect 시 임의 query가 prod 락을 잡을 수 있음.
4. **crawler/_crawler_core symlink** (`crawler/_crawler_core` → `../../crawler/core`) — 호스트 dev 편의용. 컨테이너 빌드에는 영향 없음 (Dockerfile이 별도 mount). 삭제 금지.

## 디렉터리 구조 — 특이사항

- **`web/`** — Next.js 16, App Router. 인증은 NextAuth v5 Kakao only. `web/AGENTS.md` 에 "이건 학습 데이터의 Next.js와 다름" 경고 — App Router 16 breaking changes 주의.
- **`crawler/`** — `uv run` 기반 Python 잡. `mal_crawler/jobs/` 가 잡 본체, 각각 `@scheduler.job(key="mal.<category>.<job>", ...)` 데코레이션. `crawler_core` 의존.
- **`db/migrations/`** — `NNNN_*.sql` 번호 순. `run-migrations.sh` 가 `_migrations_applied` 체크 후 미적용 분만 실행. Jenkins Migrate stage 가 자동 호출.
- **`docker/`** — **로컬 개발 전용**. prod는 `/srv/stack/docker-compose.yml` include로 통합.

## 빅픽처 아키텍처

```
KRA OpenAPI / 기상청 / 네이버 / YouTube
   │  (mal-crawler 컨테이너, APScheduler tick)
   ▼
잡: sync_races_today / sync_races_live / sync_yesterday_residual / krbc_walk_backfill / etc
   │  @track_job → crawler-dashboard 에 run 보고
   ▼
PostgreSQL `mal` schema (races, race_results, jockeys, horses, ...)
   │
   ▼
Next.js web (mal-web, :4000 → nginx → mal.kr)
   - /races, /jockeys, /horses 조회 페이지
   - 시뮬 베팅 (NextAuth 세션 기반, 비현금성)
   - sitemap.xml index 구조 (chunk 분할 — Search Console fetch 안정화, 2026-05 추가)
```

핵심 invariants:
- KRA 데이터는 **immutable history** — 한 번 들어온 race_results 는 절대 수정 안 함. 보정 필요 시 별도 corrections 테이블.
- live 결과는 `sync_races_live` 가 5분 주기로 갱신, **종료 후 1회 더 잔여 정정** (`sync_yesterday_residual`).

## 배포 — Jenkins 단일 잡

`main` push → Jenkins `mal` 잡 (SCM-poll 2분). Stage: Checkout → Web type-check → Rsync → **Migrate** → Build & restart → Smoke. COMPOSE_SERVICES = `mal-web mal-crawler`. prod `49.50.138.31:/srv/services/mal/`.

`/deploy` 스킬: `.claude/deploy.yaml` 의 `web` / `crawler` / `all` 키.

## 사고 패턴

- **마이그레이션 누락 prod 500 × 2회** — owner/nickname 추가 후 web이 PRE-migration 코드를 가리킴 → undefined column. Migrate stage 자동화로 해결됨 (2026-04).
- **KRBC 업로드 1년 walk bulk backfill 잡** (2026-05) — 너무 큰 windowing으로 KRA OpenAPI 분당 한도 초과 → 잡 timeout. 작은 chunk로 재시도 + 백오프 지수 증가.
- **sitemap.xml fetch 타임아웃** — 전체 races 단일 XML 800KB+ → Search Console crawler timeout. index → chunk 분할로 해결 (2026-05).
- **NextAuth Kakao 세션 만료 후 재로그인 루프** — Kakao 비즈채널 토큰 만료 + 클라이언트 측 silent refresh 실패 시 무한 redirect. 토큰 갱신 실패는 명시적 로그아웃 + 로그인 모달로 분리.

## 문서 맵

- **[README.md](README.md)** — 모듈 구성 + 로컬 빠른 시작.
- **[web/README.md](web/README.md)** + **[web/AGENTS.md](web/AGENTS.md)** — Next.js 16 주의사항.
- **[crawler/README.md](crawler/README.md)** — 잡 카탈로그 + APScheduler 흐름.
- **[docs/](docs/)** — `api/` (외부 API 4종) · `feature/` (개별 기능) · `spec/` (아키텍처) · `tasks/` (작업 시점 결정).

## 디자인 시스템

시각/UI 작업 전 **[DESIGN.md](DESIGN.md)** 를 반드시 먼저 읽는다. 폰트·색·간격·레이아웃·모션·데이터 시각화 규칙이 모두 거기 정의돼 있다(단일 진실원). 승인 없이 이탈 금지. QA/리뷰 시 DESIGN.md 와 어긋나는 코드는 지적한다. 핵심: 중요정보 상단·적은 컬러(중립+터프그린 액센트 1)·중복 DOM 금지(단일 반응형)·숫자는 Geist Mono tabular·모바일 우선(터치타깃 ≥44px).
