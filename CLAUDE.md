# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

`mal.kr` — 한국마사회(KRA) 공공데이터 기반 경마 데이터 아카이빙 + 분석. 데이터 소스: KRA OpenAPI (data.go.kr) · 기상청 ASOS 일자료 · 네이버 검색 · YouTube Data v3.

## 스택 한 줄

`web/` Next.js 16 (App Router · NextAuth v5 Kakao · Server Actions · **raw SQL `pg` Pool, ORM 없음**) · `crawler/` Python (`uv` · httpx + Tenacity + SQLAlchemy + APScheduler + 공유 `crawler_core`) · `db/migrations/` PostgreSQL (`mal` schema in 공용 `app` DB) · `docker/` 로컬 dev compose (Postgres 16).

## 자주 쓰는 명령

```bash
# 로컬 Postgres 띄우기 (db/migrations/*.sql 가 initdb 로 자동 적용)
cd docker && cp .env.example .env && docker compose up -d   # :5432

# Web (:3000)
cd web && npm install && npm run dev
npm run lint && npx tsc --noEmit              # Jenkins 가 둘 다 수행 (lint non-blocking)
npm test                                       # vitest (web/src/lib/__tests__)

# Crawler — typer CLI 로 한 잡 단위 ad-hoc 실행 (모듈은 src.*)
cd crawler && uv sync
uv run python -m src.main smoke               # 키·네트워크·파싱 스모크
uv run python -m src.main sync-race-date 2026-06-07
uv run python -m src.main sync-horse-name "녹색신호"
# 컨테이너 상시 스케줄러 (systemd 타이머 대체)
uv run python -m src.scheduler_main
```

마이그레이션은 prod 에서 Jenkins `Migrate DB` stage 가 자동 적용 (`db/migrations/run-migrations.sh`, `_migrations_applied` 테이블로 idempotent). 로컬은 docker `initdb` 가 적용.

## 절대 어기지 말 것

1. **owner / nickname 컬럼은 추가만, drop 금지** — prod 500이 두 번 났고 그 때문에 Migrate 스테이지 자동화가 도입됨. drop이 필요하면 새 마이그레이션으로 NULL-허용으로 만들고, 코드에서 사용 중단된 후에야 별도 마이그레이션으로 drop. **동일 마이그레이션 안에서 add+drop 금지** (mock betting 제거는 `023` add → `032` drop 으로 분리된 좋은 예).
2. **KRA 데이터는 immutable history** — 한 번 들어온 `race_results` 는 절대 수정 안 함. 보정 필요 시 별도 corrections/catchup 잡으로. live 결과는 `sync_races_live` 가 30분 주기로 갱신, 종료 후 잔여 정정은 `sync_yesterday_catchup`(07:30) + `sync_yesterday_residual`(09~12시, 미해결 race 있을 때만 KRA 호출).
3. **KRA OpenAPI key 는 IP 화이트리스트 + 분당 호출 한도**. 로컬에서 prod key 쓰면 prod 잡이 라인업·날씨 fetch 미스. 로컬 테스트는 dev key 또는 fixture replay. 백필 잡은 **작은 chunk + 지수 백오프** (1년 walk 통째로 돌리면 분당 한도 초과 → timeout).
4. **`web/.env.local` 의 `DATABASE_URL` 은 `localhost:5432` (로컬 docker postgres) 만**. 운영 DB(`49.50.138.31`) 직접 connect 시 임의 query 가 prod 락을 잡음. prod 컨테이너는 `mal_app` role 로 접속 → `search_path = mal, public`.
5. **`crawler/_crawler_core` symlink** (`→ ../../crawler/core`) — sibling `crawler` 레포의 공유 패키지(`crawler_core`, 대시보드 리포트 클라이언트)를 editable 로 설치 (`pyproject.toml [tool.uv.sources]`). 호스트 dev 편의용, 삭제 금지. 컨테이너 빌드는 build context `..` 로 sibling 을 포함.
6. **시각/UI 작업 전 [DESIGN.md](DESIGN.md) 를 먼저 읽는다** — 아래 "디자인 시스템" 참고.

## 디렉터리 구조

- **`web/`** — Next.js 16, App Router. 인증 NextAuth v5 **Kakao only** (`web/AGENTS.md`: "이건 학습 데이터의 Next.js 와 다름" — App Router 16 breaking changes 주의, `node_modules/next/dist/docs/` 참고).
  - `src/app/` 라우트 그룹: `(analysis)`(analysis·compare·rankings·records) · `(database)`(database·horses·jockeys·owner·trainer) · 상세(`horse/[horse_no]`·`jockey/[jk_no]`·`parent/[parent_no]`) · `races`·`news`·`contact`·`notifications`·`me`·정책(about·privacy·terms) · `sitemap.xml`(index→chunk).
  - `src/lib/*.ts` — **데이터 액세스는 raw SQL** (`db.ts` = lazy `pg` Pool, `query()` 헬퍼). 도메인별 모듈(`races.ts`·`horses.ts`·`jockeys.ts`·`contact.ts`·`notifications.ts`·`favorite_horses.ts`·`telegram.ts` …). ORM 없음.
  - `src/app/actions/` — Server Actions. `components/ui/` shadcn, `components/brand`·`components/seo`.
- **`crawler/`** — `uv run` 기반 Python. **모듈 루트는 `src`** (`python -m src.main` / `python -m src.scheduler_main`).
  - `src/jobs/` 가 잡 본체. `periodic.py` 가 `@track_job("mal.<name>")` 로 감싼 "스케줄 진입점"(`run_*`), `scheduler_main.py`(컨테이너 내장 APScheduler) 가 cron/interval 로 호출. `src/main.py` 는 typer 수동 CLI.
  - `src/clients/` — API별 HTTP 클라이언트 (`kra_base.py` 공통: 재시도·XML 폴백·페이징).
  - `src/monitoring.py` — `JOB_CATALOG` + `@track_job` 데코레이터. run 시작/종료를 통합 **crawler-dashboard** 에 HTTP 리포트, 실패 시 Telegram 알림(`crawler_core` 가 처리). 대시보드 down 이어도 잡은 계속.
  - `src/systemd/` — **레거시**. 현재는 `scheduler_main.py` 내장 스케줄러가 대체 (settle-bets 타이머 등 일부는 mock betting 제거로 dead).
- **`db/migrations/`** — `NNN_*.sql` 번호 순(현재 `032`까지). `run-migrations.sh` 가 `_migrations_applied` 체크 후 미적용분만 실행. 새 마이그레이션은 마지막 번호+1.
- **`docker/`** — **로컬 개발 전용** (Postgres 16 단독). prod 는 루트 `docker-compose.yml`(mal-web :4000 / mal-crawler) 을 `/srv/stack/docker-compose.yml` 이 include 로 통합.
- **`docs/`** — `api/`(외부 API 4종) · `spec/`(아키텍처·배포·systemd 레거시) · `feature/`(기능 정의서) · `tasks/`(`NNNN-*` 페이즈 히스토리).

## 빅픽처 아키텍처

```
KRA OpenAPI / 기상청 ASOS / 네이버 검색 / YouTube
   │  (mal-crawler 컨테이너 · src.scheduler_main 내장 APScheduler tick · KST)
   ▼
잡(run_*, @track_job): sync_races_today / sync_races_live / sync_yesterday_residual
                       / sync_jockeys / sync_horses_refresh / sync_weather / 백필 잡 …
   │  start_run/finish_run → crawler-dashboard 리포트 (실패 시 Telegram)
   ▼
PostgreSQL `mal` schema (races, race_results, horses, jockeys, trainers, owners,
                         dividends, weather_observations, notifications, contacts …)
   │  web/src/lib/*.ts (raw SQL via pg Pool)
   ▼
Next.js web (mal-web, PORT 4000 → nginx → mal.kr)  ·  로컬 dev :3000
   - 조회/분석 페이지 · sitemap.xml index→chunk 분할 (Search Console fetch 안정화)
```

운영 중 기능: 즐겨찾기 마필 + 다음 출주 인앱 알림(`build_favorite_notifications`) · 문의 게시판(텔레그램 알림) · 엔티티 댓글 · 날씨 폼 · 말 폼 브레이크다운. (**모의배팅은 2026-06 전면 제거** — `0004-remove-mock-betting`.)

## 배포 — Jenkins 단일 잡

`main` push → Jenkins `mal` 잡 (SCM-poll, `disableConcurrentBuilds`). Stage: Checkout → **Web type-check**(`npm ci` + `tsc --noEmit`, lint non-blocking) → Rsync → **Migrate DB** → Build & restart → Smoke. `COMPOSE_SERVICES = mal-web mal-crawler`. prod `49.50.138.31:/srv/services/mal/`, stack `/srv/stack`. Migrate 는 `PG_CONTAINER=stack-db PG_USER=mal_app PG_DB=app`.

`/deploy` 스킬: `.claude/deploy.yaml` — `web`/`crawler`/`all` 모두 같은 `mal` 잡.

## 사고 패턴 (재발 방지)

- **마이그레이션 누락 prod 500 × 2회** — owner/nickname 추가 후 web 이 PRE-migration 코드를 가리킴 → undefined column. → `Migrate DB` stage 자동화 (2026-04).
- **백필 잡 분당 한도 초과** — KRBC 1년 walk 통째 windowing → KRA OpenAPI 한도 초과 → timeout. → 작은 chunk + 지수 백오프 (예: `chunked_backfill_dividends` 6개월 윈도우 야간 청크).
- **잡이 조용히 0건 success** — env 미설정 시 silent skip(return 0) 하면 대시보드가 success 로 기록해 미수집 사고를 못 잡음 (4/25 `KRA_CHULMA_OPERATION` 미설정으로 race_entries 0건). → env 미설정은 명시적 실패로.
- **sitemap.xml fetch 타임아웃** — 전체 races 단일 XML 800KB+ → Search Console crawler timeout. → index→chunk 분할 (2026-05).
- **NextAuth Kakao 재로그인 루프** — Kakao 토큰 만료 + silent refresh 실패 시 무한 redirect. → 토큰 갱신 실패는 명시적 로그아웃 + 로그인 모달로 분리.

## 디자인 시스템

시각/UI 작업 전 **[DESIGN.md](DESIGN.md)** 를 반드시 먼저 읽는다 (단일 진실원: 폰트·색·간격·레이아웃·모션·데이터 시각화). 승인 없이 이탈 금지. QA/리뷰 시 DESIGN.md 와 어긋나는 코드는 지적한다.

핵심: **타깃 코호트 50대+ 고령 팬 → 가독성이 wedge**. 중요정보 상단 · 적은 컬러(중립 5단 + **가죽/커피 brown 액센트 1** `#7A4A2B`, semantic positive 올리브/negative clay + ▲▼ 부호 병기) · 중복 DOM 금지(단일 반응형 트리) · 숫자는 Wanted Sans 본문 + **Geist Mono tabular-nums** · 모바일 우선(터치타깃 ≥44px). 두 독립 축: **테마**(라이트/다크 auto·manual) + **글씨 크기**(`[data-scale]` 소14/보통16/크게20px, 노안용) — 헤더 "화면 설정" 단일 컨트롤, 비로그인·cookie 영속.

## 문서 맵

- **[README.md](README.md)** — 모듈 구성 + 로컬 빠른 시작 + docs 인덱스.
- **[web/README.md](web/README.md)** · **[web/AGENTS.md](web/AGENTS.md)** — Next.js 16 주의사항.
- **[crawler/README.md](crawler/README.md)** — 잡/구조 (일부 outdated, 코드 기준은 `src/`).
- **[DESIGN.md](DESIGN.md)** — 디자인 단일 진실원.
- **[docs/](docs/)** — `api/`(KRA·KMA·네이버·YouTube) · `feature/` · `spec/`(architecture·deployment·ops-systemd) · `tasks/`(페이즈 히스토리).
