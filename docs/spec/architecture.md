# 아키텍처

mal.kr 의 시스템 구조 · 컨테이너 토폴로지 · 데이터 흐름 · DB 스키마.

## 컨테이너 토폴로지 (prod)

```
┌─────────────────── 통합 서버 49.50.138.31 ───────────────────┐
│                                                                  │
│  nginx (443) ── mal.kr ──► mal-web :4000  (Next.js 16 + NextAuth v5)
│                                  │
│                                  │ pg (5432, mal_app role)
│                                  ▼
│                              stack-db :5432  (Postgres 16)
│                                  ▲
│                                  │ pg (mal_app role)
│                              mal-crawler  (Python · APScheduler · httpx)
│                                  │
│                                  ├─► data.go.kr (KRA + KMA OpenAPI)
│                                  ├─► openapi.naver.com (검색)
│                                  ├─► googleapis.com (YouTube Data v3)
│                                  ├─► mal-web :4000/api/internal/settle (모의배팅 정산 트리거)
│                                  └─► crawler-dashboard :3100 (HTTP 리포트)
│                                                                  │
│  jenkins (8080) ── SCM polling H/2 * * * * ──► main 브랜치       │
│      └─► rsync /srv/services/mal → run-migrations.sh → build &   │
│          docker compose up -d mal-web mal-crawler                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- **nginx**: TLS 종단. Let's Encrypt. 호스트 헤더로 mal.kr 분기.
- **mal-web**: Next.js 16 App Router. SSR + Server Actions. NextAuth v5 (Kakao OAuth). 모의배팅 정산 endpoint 노출.
- **mal-crawler**: 단일 컨테이너에 APScheduler `BlockingScheduler` 가 모든 잡 스케줄 + Trigger polling. 호스트 systemd 타이머는 [docs/spec/ops-systemd.md](ops-systemd.md) 의 레거시.
- **stack-db**: 통합 Postgres 16. 다른 서비스와 DB 공유하지만 권한은 mal_app role 로 mal 스키마만.
- **crawler-dashboard**: 별도 서비스. JOB_CATALOG/scraper_runs 시각화 + "지금 실행" 트리거 (15초 polling).

## DB 스키마 (PostgreSQL 16)

두 스키마 분리, role 권한으로 격리:

| 스키마 | 소유자 | 용도 | 주요 테이블 |
|---|---|---|---|
| `mal` | `mal_app` | mal.kr 비즈니스 데이터 | horses · races · race_results · race_entries · race_dividends · race_combo_dividends · race_pool_sales · race_corners · race_plans · jockeys · trainers · owners · jockey_changes · horse_rank_changes · horse_ratings · kra_news · kra_videos · users · user_favorite_horses · notifications · user_balances · bets · bet_selections · balance_transactions · race_settlements · weather_observations |
| `crawler` | `crawler_app` | 통합 크롤러 대시보드 모니터링 | scraper_jobs · scraper_runs |

- **`mal_app`** role 은 `crawler` 스키마에 권한 없음. 마이그레이션에 `crawler.scraper_jobs` seed 절대 금지 ([db/migrations/011_move_scraper_to_crawler_schema.sql](../../db/migrations/011_move_scraper_to_crawler_schema.sql) 참조).
- **JOB_CATALOG 단일 진실원**: 잡 메타는 [crawler/src/monitoring.py](../../crawler/src/monitoring.py) `JOB_CATALOG` dict 가 유일한 정의. 첫 호출 시 `register_all_jobs()` 가 대시보드에 idempotent upsert.
- 마이그레이션 적용: [db/run-migrations.sh](../../db/run-migrations.sh) — `_migrations_applied` 테이블 트래킹. Jenkins 가 빌드 전에 자동 실행.

## 데이터 흐름

### 정기 수집 (crawler → DB)

1. APScheduler 가 KST 기준 cron/interval 로 잡 실행.
2. `@track_job("mal.<name>")` 데코레이터가 lifecycle 을 crawler-dashboard 에 HTTP 리포트.
3. 클라이언트가 외부 API 호출 → 정규화 → `pg_insert(...).on_conflict_do_update(...)` 로 멱등 upsert.
4. 실패 시 Telegram 알림 (TELEGRAM_BOT_TOKEN/CHAT_ID 설정 시).

### 사용자 요청 (web SSR)

1. nginx → mal-web :4000.
2. Next.js Server Component 가 [web/src/lib/](../../web/src/lib/) 의 데이터 함수 호출 → Postgres `pg` 풀.
3. 홈은 `unstable_cache` (TTL 60s~30min) + `<Suspense>` 섹션별 streaming. 마필/경주 상세는 SSR 직접 fetch.
4. 시간 비교는 모두 KST 기준 — [web/src/lib/races.ts](../../web/src/lib/races.ts) 의 `KST_TODAY` 상수.

### 모의배팅 정산 (crawler → web)

```
mal.settle_bets (10분 cron) ─POST X-Crawler-Secret─► mal-web /api/internal/settle
                                                        │
                                                        ▼ withTransaction
                                                  bets → race_settlements → balances
                                                        │
                                                        ▼ HTTP 응답
                                              crawler 가 VOID 발생 시 Telegram 알림
```

자세한 정산 로직은 [docs/feature/mock-betting.md](../feature/mock-betting.md).

## 핵심 환경변수

prod `/srv/stack/.env`, dev `crawler/.env`:

| 카테고리 | 변수 | 누락 시 동작 |
|---|---|---|
| 인프라 | `MAL_DATABASE_URL`, `MAL_AUTH_SECRET`, `CRAWLER_SECRET` | 컨테이너 기동 실패 (compose `?:set...` 가드) |
| KRA | `KRA_SERVICE_KEY`, `KRA_CHULMA_OPERATION` | 빈 응답 / silent fail. CHULMA 미설정은 race_entries 영구 0건 사고 케이스 |
| KMA | `KMA_SERVICE_KEY` | sync_weather 명시 실패 → 모니터링 빨간 신호 |
| 외부 | `NAVER_SEARCH_CLIENT_ID/SECRET`, `YOUTUBE_API_KEY`, `YOUTUBE_KRBC_CHANNEL_ID` | 해당 잡 fail-loud (silent skip 금지 — Phase 9 안정성 강화) |
| OAuth | `AUTH_KAKAO_ID`, `AUTH_KAKAO_SECRET` | 로그인만 차단, 앱은 기동 |
| 알림 | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | 알림 조용히 skip |

## 기술 스택 요약

- **Web**: Next.js 16 · React 19 · TypeScript · TailwindCSS 4 · Radix UI · D3.js · NextAuth v5 · pg
- **Crawler**: Python 3.13 · httpx · Tenacity · SQLAlchemy 2.x (psycopg v3) · APScheduler · structlog · typer
- **DB**: Postgres 16 (mal · crawler 스키마)
- **CI/CD**: Jenkins (SCM polling H/2 * * * *) → rsync → run-migrations.sh → docker compose
- **모니터링**: crawler-dashboard (HTTP 리포트) · Telegram 알림

## 변경 영향 매트릭스

| 변경 종류 | 갱신 대상 |
|---|---|
| 새 외부 API | `docs/api/<provider>.md`, `crawler/.env.example`, `docker-compose.yml`, `crawler/src/clients/<name>.py`, `monitoring.JOB_CATALOG` |
| 새 DB 테이블 | `db/migrations/NNN_*.sql`, `crawler/src/models.py`, 본 문서의 "DB 스키마" 표 |
| 새 컨테이너 | `docker-compose.yml`, 본 문서의 "토폴로지" 다이어그램, `docs/spec/deployment.md` |
| 새 cron 잡 | `JOB_CATALOG`, `scheduler_main.py` 의 `add_job` + `TRIGGER_JOBS`, `periodic.py` 의 `@track_job` 래퍼 |
