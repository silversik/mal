# mal-crawler

KRA OpenAPI(data.go.kr) · 기상청 ASOS · YouTube Data v3 → PostgreSQL `mal` schema 수집기.
운영은 `mal-crawler` 컨테이너 안의 APScheduler(`src.scheduler_main`, KST)가 돌리고, 수동 실행은 typer CLI(`src.main`)로 한다.

> 코드가 기준이다. 이 문서와 다르면 `src/scheduler_main.py` · `src/main.py` 를 믿을 것.

## 준비

```bash
cd crawler
cp .env.example .env    # 키·DATABASE_URL 편집 (로컬은 localhost:5432 docker postgres 만)
uv sync                 # 의존성 + sibling crawler_core(_crawler_core symlink, editable)
```

- **로컬에서 prod KRA 키 금지** — IP 화이트리스트 + 분당 한도라 prod 잡이 fetch 미스. dev 키 또는 fixture/mock.
- 주요 env: `DATABASE_URL`, `KRA_SERVICE_KEY`(엔드포인트별 `KRA_SERVICE_KEY_<API>` 로 개별 지정 가능), `KRA_CHULMA_OPERATION`,
  `KMA_SERVICE_KEY`, `YOUTUBE_API_KEY` / `YOUTUBE_KRBC_CHANNEL_ID`, `LOG_LEVEL` — 전체는 `src/config.py`.
  잡이 읽는 env 를 추가하면 루트 `docker-compose.yml` 의 mal-crawler `environment` 에도 주입할 것 (미설정은 silent 0건이 아니라 명시적 실패).

## 구조 (모듈 루트 `src`)

```
src/
├── main.py            typer 수동 CLI  (python -m src.main <cmd>)
├── scheduler_main.py  컨테이너 상시 스케줄러 (python -m src.scheduler_main, Dockerfile CMD)
├── monitoring.py      JOB_CATALOG + @track_job — crawler-dashboard 리포트, 실패 시 Telegram (crawler_core)
├── redact.py          serviceKey/key 마스킹 — 로그·대시보드·CLI 예외 출력 공통
├── config.py · db.py (SQLAlchemy session_scope) · models.py · logging.py (structlog, 마스킹 renderer)
├── clients/           API별 HTTP 클라이언트 — kra_base.py 공통(재시도·XML 폴백·페이징·NODATA/쿼터 판정)
└── jobs/              잡 본체. periodic.py = @track_job("mal.<name>") 스케줄 진입점(run_*)
                       _failloud.py = 단위 루프 "전부 실패면 raise" 헬퍼
```

`systemd/` 는 **레거시** (scheduler_main 이 대체). 마이그레이션은 `../db/migrations/`.

## 스케줄 잡 (`src/scheduler_main.py`, 시각은 KST)

공통 옵션 `coalesce=True, max_instances=1, misfire_grace_time=600`. 모든 잡은 `@track_job` 으로 대시보드에 run 기록,
대시보드 "지금 실행" 은 15초 주기 `mal.trigger_poll` 이 같은 job key 로 디스패치한다.

| job key | 스케줄 | 하는 일 | 쓰는 테이블 |
|---|---|---|---|
| `mal.sync_videos` | 3시간마다 | KRBC YouTube 최신 업로드 20건 | `kra_videos`, `sync_meta` |
| `mal.sync_race_entries` | 3시간마다 | 향후 10일 출전표 (API26_2, `KRA_CHULMA_OPERATION` 필수) | `race_entries`, `races` |
| `mal.backfill_races_from_entries` | 3시간마다 | `race_entries.raw` → races 빈 메타(거리·등급·발주시각) 백필 | `races` |
| `mal.build_favorite_notifications` | 1시간마다 | 즐겨찾기 마필 출주 확정 → 인앱 알림 (dedup_key) | `notifications` |
| `mal.chunked_dividends_backfill` | 매일 02:30 | 결과는 있는데 combo 배당 빠진 (date, meet) gap 청크 백필 (~15 call 예산, 3회 실패 skip) | `race_dividends`, `race_combo_dividends`, `sync_meta` |
| `mal.sync_weather` | 매일 03:00 | 기상청 ASOS 직전 7일(KST 어제까지) 재수집 | `weather_observations` |
| `mal.sync_videos_bulk` | 매월 1일 04:00 | KRBC 업로드 플레이리스트 12개월 walk | `kra_videos` |
| `mal.sync_race_plan` | 매일 05:00 | 대상경주 연간계획 — 올해 (+11~12월엔 내년도) | `race_plans` |
| `mal.sync_race_info` | 매일 05:30, 22:30 | API187 races 메타 백필 (현재 빈 응답 — 실질은 today_meta) | `races` |
| `mal.sync_jockeys` | 매일 06:00 | 기수 마스터 | `jockeys` |
| `mal.sync_race_today_meta` | 06~21시 매시 05분 | race.kra.co.kr HTML 파싱 — 당일 발주시각·거리 | `races` |
| `mal.sync_trainers` | 매일 06:15 | 조교사 마스터 | `trainers` |
| `mal.sync_owners` | 매일 06:20 | 마주 마스터 | `owners` |
| `mal.sync_jockey_changes` | 매일 06:25 | 기수변경 이벤트 (KRA 기본 ~1개월 윈도우) | `jockey_changes` |
| `mal.sync_horses_backfill` | 매일 06:30 | `raw` NULL 마필 API42_1 재조회 (not-found 원장) | `horses`, `sync_meta` |
| `mal.sync_horse_rank_changes` | 매일 06:35 | 경주마 등급변동 이력 전체 | `horse_rank_changes` |
| `mal.sync_horses_refresh` | 매일 07:00 | `updated_at` 30일 초과 마필 300건 재조회 | `horses` |
| `mal.sync_horse_ratings` | 토 07:30 | KRA 주간 레이팅 공시 | `horse_ratings` |
| `mal.sync_yesterday_catchup` | 매일 07:30 | 전날 결과·배당·매출 재수집 + "출전표 있는데 결과 0건" invariant 실패 알림 | `race_results`, `races`, `horses`, `race_dividends`, `race_combo_dividends`, `race_pool_sales` |
| `mal.sync_yesterday_residual` | 09~12시 정각 | 전날 미해결 race 가 있을 때만 결과·배당 재시도 | `race_results`, `races`, `horses`, `race_dividends`, `race_combo_dividends` |
| `mal.sync_races_live` | 10:00~22:30 매 30분 | 경기일 실시간 결과·배당 (오늘 races 없으면 skip, 배당은 해당 경마장만) | `race_results`, `races`, `horses`, `race_dividends`, `race_combo_dividends` |
| `mal.sync_races_today` | 매일 22:00 | 오늘 경주결과 전 경마장 | `race_results`, `races`, `horses` |
| `mal.sync_race_dividends` | 매일 22:45 | 오늘 확정배당율 | `race_dividends`, `race_combo_dividends` |
| `mal.sync_race_sales` | 매일 22:50 | 오늘 풀별 매출 | `race_pool_sales` |
| `mal.sync_videos_backfill` | 매일 23:00 | 영상 없는 경주(365일) YouTube search 매칭, 실행당 50건 | `kra_videos` |

`race_results` 는 immutable history — 보정은 위 catchup/residual 잡으로만. run 기록은 DB 가 아니라 crawler-dashboard(HTTP)에 남는다.

## 수동 CLI (`uv run python -m src.main <cmd>`)

`--help` 로 각 명령 옵션 확인. 미처리 예외는 키를 마스킹(`src/redact.py`)해서 stderr 로 출력하고 exit 1.

- **점검**: `smoke` (API42_1 1건) · `smoke-videos` (DB 쓰기 없음) · `register-dashboard-jobs` (컨테이너 기동 시 호출) · `check-stale` (대시보드 위임, no-op) · 헬스체크는 *healthcheck 명령 참고* (`--help` 에 있으면 그쪽)
- **마필**: `sync-horse-name <마명>` · `sync-horse-no <hr_no>` · `backfill-horse-raw --limit --sleep`
- **경주 결과/메타**: `sync-race-date <YYYY-MM-DD> [--meet]` · `sync-race-plan <year> [--meet]`
- **배당/매출**: `sync-dividend-date <date> [--meet]` · `sync-race-sales-date <date> [--meet]` · `chunked-dividends-backfill --budget --lookback-days --max-attempts`
- **마스터/이벤트**: `sync-jockeys` · `sync-trainers` · `sync-owners` · `sync-jockey-changes` · `sync-horse-rank-changes`
- **영상/날씨**: `sync-videos --n` · `sync-weather --days` · `backfill-weather <start> <end> --chunk-days`
- **one-shot 백필** (작은 chunk·sleep 유지 — 분당 한도): `backfill-history <start> <end> --sleep` · `backfill-history-33y` · `backfill-dividends --months` · `backfill-race-sales --days` · `backfill-jockey-changes --days`
- **`periodic-*`**: 스케줄 잡을 `@track_job` 째로 한 번 실행 (대시보드 run 기록됨). `periodic-videos` · `-videos-backfill` · `-videos-bulk` · `-races-today` · `-races-live` · `-races-yesterday`(= sync_yesterday_catchup) · `-jockeys` · `-trainers` · `-owners` · `-jockey-changes` · `-horse-rank-changes` · `-horse-ratings` · `-horses-backfill` · `-horses-refresh` · `-race-plan` · `-race-entries` · `-race-info` · `-race-today-meta` · `-race-dividends` · `-race-sales` · `-chunked-dividends`

## 테스트

```bash
uv run pytest -q          # tests/ (conftest 가 더미 DATABASE_URL/KRA 키 — 실 DB·외부 API 호출 없음)
uvx ruff check src tests
```

테스트는 클라이언트·`session_scope`·`crawler_core` 를 mock 한다. 실제 KRA/KMA/YouTube 호출 금지.
