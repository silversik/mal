"""CLI entry point for the mal collector.

Usage:
    uv run python -m src.main sync-horse-name <name>
    uv run python -m src.main sync-horse-no <hr_no>
    uv run python -m src.main sync-race-date <YYYY-MM-DD>
    uv run python -m src.main smoke
    uv run python -m src.main healthcheck   # 읽기 전용 ops 점검 (exit 0/1/2)

미처리 예외는 `run()` 이 API 키를 마스킹(src/redact.py)해서 stderr 로 출력한다.
"""
from __future__ import annotations

import sys
import traceback
from datetime import datetime
from types import TracebackType

import typer

from .clients.horse_detail import HorseDetailClient
from .jobs.periodic import (
    run_chunked_dividends_backfill,
    run_sync_horse_rank_changes,
    run_sync_horse_ratings,
    run_sync_horses_backfill,
    run_sync_jockey_changes,
    run_sync_jockeys,
    run_sync_owners,
    run_sync_race_entries,
    run_sync_race_plan,
    run_sync_race_sales,
    run_sync_race_today_meta,
    run_sync_races_live,
    run_sync_races_today,
    run_sync_trainers,
    run_sync_videos,
    run_sync_videos_backfill,
    run_sync_videos_bulk,
    run_sync_yesterday_catchup,
)
from .jobs.sync_horses import backfill_missing_raw, sync_by_name, sync_by_no
from .jobs.sync_jockeys import sync_all_jockeys
from .jobs.sync_race_plan import sync_year as sync_race_plan_year
from .jobs.sync_races import sync_date, sync_date_all_meets
from .jobs.sync_videos import smoke_videos, sync_videos
from .jobs.sync_weather import backfill as backfill_weather
from .jobs.sync_weather import sync_recent as sync_weather_recent
from .logging import configure_logging, get_logger
from .monitoring import register_all_jobs
from .redact import redact

# pretty_exceptions_show_locals=False — 수동 실행 중 예외 시 typer(rich) traceback 이
# 프레임 locals(params dict 의 serviceKey 등)를 터미널에 그대로 찍지 않도록.
app = typer.Typer(
    add_completion=False,
    help="mal.kr KRA data collector",
    pretty_exceptions_show_locals=False,
)
configure_logging()
log = get_logger("main")


@app.command("sync-horse-name")
def cmd_sync_horse_name(
    name: str = typer.Argument(..., help="마명 (예: '녹색신호')"),
) -> None:
    """Fetch horses matching a name and upsert into `horses`."""
    n = sync_by_name(name)
    typer.echo(f"upserted {n} rows")


@app.command("sync-horse-no")
def cmd_sync_horse_no(
    hr_no: str = typer.Argument(..., help="마필고유번호"),
) -> None:
    """Fetch a single horse by number and upsert."""
    n = sync_by_no(hr_no)
    typer.echo(f"upserted {n} rows")


@app.command("backfill-horse-raw")
def cmd_backfill_horse_raw(
    limit: int | None = typer.Option(None, help="최대 처리 건수 (생략 시 전체)"),
    sleep: float = typer.Option(0.15, help="API 호출 간격(초)"),
) -> None:
    """`raw` 가 NULL 인 horses 를 API42_1 으로 재조회해 모색/특징까지 채운다."""
    n = backfill_missing_raw(limit=limit, sleep_sec=sleep)
    typer.echo(f"backfilled {n} rows")


@app.command("sync-race-date")
def cmd_sync_race_date(
    rc_date: str = typer.Argument(..., help="경주 일자 (YYYY-MM-DD 또는 YYYYMMDD)"),
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 3곳 모두)"),
) -> None:
    """Fetch race results for a given date and upsert into `race_results`."""
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            d = datetime.strptime(rc_date, fmt).date()
            break
        except ValueError:
            continue
    else:
        typer.echo("Invalid date format. Use YYYY-MM-DD or YYYYMMDD.")
        raise typer.Exit(code=1)

    n = sync_date(d, meet=meet) if meet is not None else sync_date_all_meets(d)
    typer.echo(f"upserted {n} race result rows")


@app.command("sync-jockeys")
def cmd_sync_jockeys(
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 전체)"),
) -> None:
    """Fetch all active jockeys and upsert into `jockeys`."""
    n = sync_all_jockeys(meet=meet)
    typer.echo(f"upserted {n} jockey rows")


@app.command("smoke")
def cmd_smoke() -> None:
    """Quick smoke test: hit API42_1 once and print a summary of the first item."""
    with HorseDetailClient() as client:
        items = client.sample(n=1)
        if not items:
            typer.echo("no items returned")
            raise typer.Exit(code=1)
        it = items[0]
        typer.echo(
            f"OK — got {len(items)} item(s). "
            f"hrNo={it.get('hrNo')} hrNm={it.get('hrNm')} "
            f"sex={it.get('sex')} birthDt={it.get('birthDt')} "
            f"fhrNm={it.get('fhrNm')} mhrNm={it.get('mhrNm')}"
        )


@app.command("sync-videos")
def cmd_sync_videos(
    n: int = typer.Option(20, help="가져올 최신 영상 수 (max 50)"),
) -> None:
    """Fetch latest KRBC YouTube uploads and upsert into `kra_videos`."""
    count = sync_videos(max_results=n)
    typer.echo(f"upserted {count} video rows")


@app.command("smoke-videos")
def cmd_smoke_videos(
    n: int = typer.Option(3, help="표시할 항목 수"),
) -> None:
    """Fetch latest KRBC videos and print without DB write."""
    videos = smoke_videos(n=n)
    if not videos:
        typer.echo("no videos returned")
        raise typer.Exit(code=1)
    for v in videos:
        dur = f"{v.duration_sec}s" if v.duration_sec else "?"
        typer.echo(
            f"  · [{v.published_at:%Y-%m-%d}] {v.title[:60]} "
            f"(id={v.video_id}, dur={dur}, views={v.view_count})"
        )


# ============================================================================
# Periodic entry points — scheduler_main 이 호출하는 run_* 를 수동으로 1회 실행.
# @track_job 으로 crawler-dashboard 에 run 이 기록된다.
# 대시보드 기록 없이 ad-hoc 실행은 위의 `sync-videos` / `sync-race-date` 등을 사용.
# ============================================================================

@app.command("periodic-videos")
def cmd_periodic_videos() -> None:
    """[scheduled] sync_videos — tracked run."""
    n = run_sync_videos()
    typer.echo(f"upserted {n} video rows")


@app.command("periodic-races-today")
def cmd_periodic_races_today() -> None:
    """[scheduled] sync_races_today — tracked run."""
    n = run_sync_races_today()
    typer.echo(f"upserted {n} race result rows")


@app.command("periodic-races-live")
def cmd_periodic_races_live() -> None:
    """[scheduled] sync_races_live — KST 10:00~22:30 매 30분 실시간 결과·배당."""
    n = run_sync_races_live()
    typer.echo(f"live upserted {n} rows")


@app.command("periodic-races-yesterday")
def cmd_periodic_races_yesterday() -> None:
    """[scheduled] sync_yesterday_catchup — 전날 경주결과·배당·매출 누락 보정 (07:30 KST)."""
    n = run_sync_yesterday_catchup()
    typer.echo(f"catchup upserted {n} rows for yesterday")


@app.command("periodic-jockeys")
def cmd_periodic_jockeys() -> None:
    """[scheduled] sync_jockeys — tracked run."""
    n = run_sync_jockeys()
    typer.echo(f"upserted {n} jockey rows")


@app.command("periodic-horses-backfill")
def cmd_periodic_horses_backfill() -> None:
    """[scheduled] sync_horses_backfill — tracked run."""
    n = run_sync_horses_backfill()
    typer.echo(f"backfilled {n} horse rows")


@app.command("periodic-horses-refresh")
def cmd_periodic_horses_refresh() -> None:
    """[scheduled] sync_horses_refresh — stale horses (updated_at > 30d) 재조회."""
    from .jobs.periodic import run_sync_horses_refresh
    n = run_sync_horses_refresh()
    typer.echo(f"refreshed {n} horse rows")


@app.command("periodic-race-plan")
def cmd_periodic_race_plan() -> None:
    """[scheduled] sync_race_plan — 대상경주 연간계획 (올해 + 11~12월엔 내년도)."""
    n = run_sync_race_plan()
    typer.echo(f"upserted {n} race plan rows")


@app.command("sync-race-plan")
def cmd_sync_race_plan(
    year: int = typer.Argument(..., help="연도 (예: 2027)"),
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 3곳 모두)"),
) -> None:
    """[ad-hoc] 특정 연도 대상경주 계획 수동 조회. KRA 미공개(NODATA)는 0건으로 처리."""
    n = sync_race_plan_year(year, meet=meet, allow_no_data=True)
    typer.echo(f"upserted {n} race plan rows ({year})")


@app.command("periodic-race-entries")
def cmd_periodic_race_entries() -> None:
    """[scheduled] sync_race_entries — 예정 출전표."""
    n = run_sync_race_entries()
    typer.echo(f"upserted {n} race entry rows")


@app.command("periodic-race-today-meta")
def cmd_periodic_race_today_meta() -> None:
    """[scheduled] sync_race_today_meta — seoulMain.do HTML 크롤링."""
    n = run_sync_race_today_meta()
    typer.echo(f"upserted {n} race meta rows")


@app.command("periodic-videos-backfill")
def cmd_periodic_videos_backfill() -> None:
    """[scheduled] sync_videos_backfill — 누락 경주 영상 search."""
    n = run_sync_videos_backfill()
    typer.echo(f"backfilled {n} video rows")


@app.command("periodic-videos-bulk")
def cmd_periodic_videos_bulk() -> None:
    """[scheduled] sync_videos_bulk — KRBC 업로드 1년 walk 일괄 적재."""
    n = run_sync_videos_bulk()
    typer.echo(f"bulk-upserted {n} video rows")


@app.command("sync-dividend-date")
def cmd_sync_dividend_date(
    rc_date: str = typer.Argument(..., help="경주 일자 (YYYY-MM-DD 또는 YYYYMMDD)"),
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 3곳 모두)"),
) -> None:
    """Ad-hoc: 특정 날짜 확정배당율을 fetch & upsert."""
    from .jobs.sync_race_dividends import sync_date as sync_div
    from .jobs.sync_race_dividends import sync_date_all_meets as sync_div_all
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            d = datetime.strptime(rc_date, fmt).date()
            break
        except ValueError:
            continue
    else:
        typer.echo("Invalid date format. Use YYYY-MM-DD or YYYYMMDD.")
        raise typer.Exit(code=1)
    n = sync_div(d, meet=meet) if meet is not None else sync_div_all(d)
    typer.echo(f"upserted {n} race_dividend rows")


@app.command("chunked-dividends-backfill")
def cmd_chunked_dividends_backfill(
    budget: int = typer.Option(15, help="이번 청크에서 호출할 최대 sync_date 수"),
    lookback_days: int = typer.Option(365, help="gap 탐색 윈도우 (KST 오늘 - N일 ~ 어제)"),
    max_attempts: int = typer.Option(3, help="combo 미생성 gap 을 exhausted 로 볼 시도 횟수"),
) -> None:
    """[manual] 배당 누락 (date, meet) gap 백필 1회 수동 실행 (스케줄러 02:30 KST 와 동일)."""
    from .jobs.chunked_backfill_dividends import format_summary, run_chunk
    s = run_chunk(max_calls=budget, lookback_days=lookback_days, max_attempts=max_attempts)
    typer.echo(format_summary(s))


@app.command("periodic-chunked-dividends")
def cmd_periodic_chunked_dividends() -> None:
    """[scheduled] chunked_dividends_backfill — tracked run."""
    n = run_chunked_dividends_backfill()
    typer.echo(f"chunked added {n} race_dividend rows")


@app.command("sync-trainers")
def cmd_sync_trainers(
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 전체)"),
) -> None:
    """Fetch all active trainers and upsert into `trainers`."""
    from .jobs.sync_trainers import sync_all_trainers
    n = sync_all_trainers(meet=meet)
    typer.echo(f"upserted {n} trainer rows")


@app.command("periodic-trainers")
def cmd_periodic_trainers() -> None:
    """[scheduled] sync_trainers — tracked run."""
    n = run_sync_trainers()
    typer.echo(f"upserted {n} trainer rows")


@app.command("sync-owners")
def cmd_sync_owners(
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 전체)"),
) -> None:
    """Fetch all active owners and upsert into `owners`."""
    from .jobs.sync_owners import sync_all_owners
    n = sync_all_owners(meet=meet)
    typer.echo(f"upserted {n} owner rows")


@app.command("periodic-owners")
def cmd_periodic_owners() -> None:
    """[scheduled] sync_owners — tracked run."""
    n = run_sync_owners()
    typer.echo(f"upserted {n} owner rows")


@app.command("sync-race-sales-date")
def cmd_sync_race_sales_date(
    rc_date: str = typer.Argument(..., help="경주 일자 (YYYY-MM-DD 또는 YYYYMMDD)"),
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 3곳 모두)"),
) -> None:
    """Ad-hoc: 특정 날짜 풀별 매출액을 fetch & upsert."""
    from .jobs.sync_race_sales import sync_date as sync_sales
    from .jobs.sync_race_sales import sync_date_all_meets as sync_sales_all
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            d = datetime.strptime(rc_date, fmt).date()
            break
        except ValueError:
            continue
    else:
        typer.echo("Invalid date format. Use YYYY-MM-DD or YYYYMMDD.")
        raise typer.Exit(code=1)
    n = sync_sales(d, meet=meet) if meet is not None else sync_sales_all(d)
    typer.echo(f"upserted {n} race_pool_sales rows")


@app.command("backfill-race-sales")
def cmd_backfill_race_sales(
    days: int = typer.Option(180, help="과거 며칠치 일자별 백필"),
) -> None:
    """[one-shot] race_pool_sales 1차 백필 — 최근 N 일 일자별 순회."""
    from .jobs.sync_race_sales import backfill_recent_days
    n = backfill_recent_days(days=days)
    typer.echo(f"backfilled {n} race_pool_sales rows")


@app.command("periodic-race-sales")
def cmd_periodic_race_sales() -> None:
    """[scheduled] sync_race_sales — tracked run."""
    n = run_sync_race_sales()
    typer.echo(f"upserted {n} race_pool_sales rows")


@app.command("sync-jockey-changes")
def cmd_sync_jockey_changes() -> None:
    """Fetch recent jockey-change events (KRA 기본 윈도우 ~1개월) and upsert."""
    from .jobs.sync_jockey_changes import sync_recent
    n = sync_recent()
    typer.echo(f"upserted {n} jockey_change rows")


@app.command("backfill-jockey-changes")
def cmd_backfill_jockey_changes(
    days: int = typer.Option(180, help="과거 며칠치 일자별 백필 (1차 적재용)"),
) -> None:
    """[one-shot] 최근 N 일 일자별 백필.

    KRA 기본 응답이 ~1개월이라 sync-jockey-changes 1회로는 빈 과거가 못 채워짐 →
    초기 적재용으로만 사용. 일일 운영은 periodic-jockey-changes (cron 06:25 KST).
    """
    from .jobs.sync_jockey_changes import backfill_recent_days
    n = backfill_recent_days(days=days)
    typer.echo(f"backfilled {n} jockey_change rows")


@app.command("periodic-jockey-changes")
def cmd_periodic_jockey_changes() -> None:
    """[scheduled] sync_jockey_changes — tracked run."""
    n = run_sync_jockey_changes()
    typer.echo(f"upserted {n} jockey_change rows")


@app.command("sync-horse-rank-changes")
def cmd_sync_horse_rank_changes() -> None:
    """Fetch all KRA 등급변동 events and upsert into `horse_rank_changes`."""
    from .jobs.sync_horse_rank_changes import sync_all
    n = sync_all()
    typer.echo(f"upserted {n} horse_rank_change rows")


@app.command("periodic-horse-rank-changes")
def cmd_periodic_horse_rank_changes() -> None:
    """[scheduled] sync_horse_rank_changes — tracked run."""
    n = run_sync_horse_rank_changes()
    typer.echo(f"upserted {n} horse_rank_change rows")


@app.command("periodic-horse-ratings")
def cmd_periodic_horse_ratings() -> None:
    """[scheduled] sync_horse_ratings — 주간 레이팅 공시."""
    n = run_sync_horse_ratings()
    typer.echo(f"upserted {n} horse_rating rows")


@app.command("sync-weather")
def cmd_sync_weather(
    days: int = typer.Option(7, help="직전 N일 ASOS 일자료 재수집 (cron 과 동일)"),
) -> None:
    """[manual] sync_weather — 3개 관측소 직전 N일치 갱신."""
    n = sync_weather_recent(days=days)
    typer.echo(f"upserted {n} weather_observation rows")


@app.command("backfill-weather")
def cmd_backfill_weather(
    start: str = typer.Argument(..., help="시작일 YYYY-MM-DD"),
    end: str = typer.Argument(..., help="종료일 YYYY-MM-DD (포함)"),
    chunk_days: int = typer.Option(90, help="한 번에 요청할 일수 (KMA 응답 한도 분할)"),
) -> None:
    """[manual] 기상청 ASOS 일자료 백필 — 과거 임의 범위. chunk_days 단위로 분할."""
    s = datetime.strptime(start, "%Y-%m-%d").date()
    e = datetime.strptime(end, "%Y-%m-%d").date()
    n = backfill_weather(s, e, chunk_days=chunk_days)
    typer.echo(f"upserted {n} weather_observation rows")


@app.command("register-dashboard-jobs")
def cmd_register_dashboard_jobs() -> None:
    """통합 크롤러 대시보드에 JOB_CATALOG 전체 idempotent 등록.

    컨테이너 entrypoint 에서 기동 시 한 번 호출 권장 — 대시보드 cold-start
    상태에서도 job 목록이 보이도록 미리 upsert.
    """
    register_all_jobs()
    typer.echo("dashboard jobs registered")


def _print_redacted_exception(
    exc_type: type[BaseException], exc: BaseException, tb: TracebackType | None
) -> None:
    """미처리 예외의 메시지·traceback(체인 포함)을 API 키 마스킹 후 stderr 로.

    httpx `HTTPStatusError` 메시지엔 serviceKey/key 가 실린 전체 URL 이 들어 있어
    typer/기본 excepthook 그대로면 수동 실행 터미널·CI 로그에 키가 찍힌다.
    """
    text = "".join(traceback.format_exception(exc_type, exc, tb))
    sys.stderr.write(redact(text))
    sys.stderr.flush()


def _redacting_excepthook(
    exc_type: type[BaseException], exc: BaseException, tb: TracebackType | None
) -> None:
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc, tb)
        return
    _print_redacted_exception(exc_type, exc, tb)


def run() -> None:
    """CLI 진입점 — `app()` 을 감싸 미처리 예외를 마스킹해서 출력하고 exit 1.

    typer 는 `app()` 호출 시 자체 excepthook(rich traceback)을 설치하므로 hook 교체만으론
    부족하다 — 여기서 먼저 잡아 출력한다. click 의 사용법 오류/`typer.Exit` 는 click 이
    SystemExit 로 처리하므로 그대로 통과.
    """
    sys.excepthook = _redacting_excepthook
    try:
        app()
    except Exception as exc:  # noqa: BLE001 — 마스킹 출력 후 비정상 종료
        _print_redacted_exception(type(exc), exc, exc.__traceback__)
        raise SystemExit(1) from None


@app.command("healthcheck")
def cmd_healthcheck(
    json_output: bool = typer.Option(False, "--json", help="표 대신 JSON 으로 출력"),
    dashboard: bool = typer.Option(
        True, "--dashboard/--no-dashboard", help="crawler-dashboard GET (3초) 점검 여부",
    ),
) -> None:
    """[ops] 읽기 전용 헬스체크 — env·DB·데이터 신선도. exit 0=OK, 1=FAIL, 2=WARN 만.

    prod: `docker exec mal-crawler python -m src.main healthcheck`.
    외부 API 호출·DB 쓰기 없음 (모든 쿼리는 READ ONLY 트랜잭션 + rollback).
    """
    from .healthcheck import run_healthcheck

    raise typer.Exit(run_healthcheck(json_output=json_output, check_dashboard_url=dashboard))


if __name__ == "__main__":
    run()
