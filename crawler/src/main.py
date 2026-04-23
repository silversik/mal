"""CLI entry point for the mal collector.

Usage:
    uv run python -m src.main sync-horse-name <name>
    uv run python -m src.main sync-horse-no <hr_no>
    uv run python -m src.main sync-race-date <YYYY-MM-DD>
    uv run python -m src.main seed-sample
    uv run python -m src.main smoke
"""
from __future__ import annotations

from datetime import datetime

import typer

from .clients.horse_detail import HorseDetailClient
from .jobs.periodic import (
    run_chunked_dividends_backfill,
    run_sync_horse_ratings,
    run_sync_horses_backfill,
    run_sync_jockeys,
    run_sync_news,
    run_sync_owners,
    run_sync_race_dividends,
    run_sync_race_entries,
    run_sync_race_info,
    run_sync_race_plan,
    run_sync_races_today,
    run_sync_trainers,
    run_sync_videos,
    run_sync_videos_backfill,
)
from .jobs.sync_horses import backfill_missing_raw, sync_by_name, sync_by_no, upsert_horses
from .jobs.sync_jockeys import sync_all_jockeys
from .jobs.sync_news import smoke_news, sync_news
from .jobs.sync_race_info import sync_races_by_year
from .jobs.sync_races import sync_date, sync_date_all_meets
from .jobs.sync_videos import smoke_videos, sync_videos
from .logging import configure_logging, get_logger
from .monitoring import check_stale, register_all_jobs

app = typer.Typer(add_completion=False, help="mal.kr KRA data collector")
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


@app.command("seed-sample")
def cmd_seed_sample(
    n: int = typer.Option(10, help="가져올 마필 수"),
) -> None:
    """Fetch N arbitrary horses (no filter) and upsert. Useful for first-run seeding."""
    with HorseDetailClient() as client:
        items = client.sample(n=n)
    typer.echo(f"fetched {len(items)} items")
    upserted = upsert_horses(items)
    typer.echo(f"upserted {upserted} rows")


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

    if meet is not None:
        n = sync_date(d, meet=meet)
    else:
        n = sync_date_all_meets(d)
    typer.echo(f"upserted {n} race result rows")


@app.command("sync-today")
def cmd_sync_today() -> None:
    """Fetch today's race results across all meets and backfill `races`."""
    from datetime import date as _date
    n = sync_date_all_meets(_date.today())
    typer.echo(f"upserted {n} race result rows for today")


@app.command("sync-jockeys")
def cmd_sync_jockeys(
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 전체)"),
) -> None:
    """Fetch all active jockeys and upsert into `jockeys`."""
    n = sync_all_jockeys(meet=meet)
    typer.echo(f"upserted {n} jockey rows")


@app.command("sync-races")
def cmd_sync_races(
    year: int = typer.Argument(..., help="시행 연도 (예: 2024)"),
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 전체)"),
) -> None:
    """Fetch race metadata for a year and upsert into `races`."""
    n = sync_races_by_year(year, meet=meet)
    typer.echo(f"upserted {n} race rows")


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


@app.command("sync-news")
def cmd_sync_news() -> None:
    """Fetch KRA RSS 공지/뉴스 and upsert into `kra_news`."""
    n = sync_news()
    typer.echo(f"upserted {n} news rows")


@app.command("smoke-news")
def cmd_smoke_news(
    limit: int = typer.Option(3, help="표시할 항목 수"),
) -> None:
    """Fetch RSS once and print parsed items (no DB write)."""
    items = smoke_news()
    if not items:
        typer.echo("no items returned (304 Not Modified or empty feed)")
        raise typer.Exit(code=1)
    typer.echo(f"OK — got {len(items)} item(s)")
    for it in items[:limit]:
        typer.echo(
            f"  · [{it.published_at:%Y-%m-%d %H:%M %Z}] {it.title[:60]} "
            f"(category={it.category}, summary_len={len(it.summary or '')})"
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
# Periodic entry points — systemd timer 가 호출. scraper_runs 에 기록됨.
# 수동 ad-hoc 실행은 위의 `sync-news` / `sync-today` 등을 그대로 사용.
# ============================================================================

@app.command("periodic-news")
def cmd_periodic_news() -> None:
    """[scheduled] sync_news — tracked run."""
    n = run_sync_news()
    typer.echo(f"upserted {n} news rows")


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


@app.command("backfill-history")
def cmd_backfill_history(
    start: str = typer.Argument(..., help="시작 날짜 YYYY-MM-DD (inclusive)"),
    end: str = typer.Argument(..., help="종료 날짜 YYYY-MM-DD (inclusive)"),
    sleep: float = typer.Option(0.3, help="날짜간 대기 (초) — KRA rate-limit 보호"),
) -> None:
    """[one-shot] 과거 날짜 범위 전체 경주결과 + horses enrichment. 콜드스타트용.

    예: 최근 33년 일괄 부트스트랩 —
        python -m src.main backfill-history 1993-04-21 2026-04-20
    """
    from datetime import datetime as _dt

    from .jobs.backfill_history import backfill_history

    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            s_date = _dt.strptime(start, fmt).date()
            e_date = _dt.strptime(end, fmt).date()
            break
        except ValueError:
            continue
    else:
        typer.echo("Invalid date format. Use YYYY-MM-DD or YYYYMMDD.")
        raise typer.Exit(code=1)

    if s_date > e_date:
        typer.echo("start must be <= end")
        raise typer.Exit(code=1)

    n = backfill_history(s_date, e_date, sleep_sec=sleep)
    typer.echo(f"backfilled {n} race_result rows across {(e_date - s_date).days + 1} days")


@app.command("backfill-history-33y")
def cmd_backfill_history_33y() -> None:
    """[one-shot, tracked] 최근 33년 전체 부트스트랩 (대시보드에 run 기록됨)."""
    from .jobs.backfill_history import run_backfill_last_33y
    n = run_backfill_last_33y()
    typer.echo(f"backfilled {n} race_result rows (last 33 years)")


@app.command("periodic-race-plan")
def cmd_periodic_race_plan() -> None:
    """[scheduled] sync_race_plan — 대상경주 연간계획."""
    n = run_sync_race_plan()
    typer.echo(f"upserted {n} race plan rows")


@app.command("periodic-race-entries")
def cmd_periodic_race_entries() -> None:
    """[scheduled] sync_race_entries — 예정 출전표."""
    n = run_sync_race_entries()
    typer.echo(f"upserted {n} race entry rows")


@app.command("periodic-race-info")
def cmd_periodic_race_info() -> None:
    """[scheduled] sync_race_info — API187 메타 백필."""
    n = run_sync_race_info()
    typer.echo(f"backfilled {n} race metadata rows")


@app.command("periodic-videos-backfill")
def cmd_periodic_videos_backfill() -> None:
    """[scheduled] sync_videos_backfill — 누락 경주 영상 search."""
    n = run_sync_videos_backfill()
    typer.echo(f"backfilled {n} video rows")


@app.command("periodic-race-dividends")
def cmd_periodic_race_dividends() -> None:
    """[scheduled] sync_race_dividends — 오늘 확정배당율."""
    n = run_sync_race_dividends()
    typer.echo(f"upserted {n} race_dividend rows")


@app.command("sync-dividend-date")
def cmd_sync_dividend_date(
    rc_date: str = typer.Argument(..., help="경주 일자 (YYYY-MM-DD 또는 YYYYMMDD)"),
    meet: int | None = typer.Option(None, help="1=서울 2=제주 3=부경 (생략 시 3곳 모두)"),
) -> None:
    """Ad-hoc: 특정 날짜 확정배당율을 fetch & upsert."""
    from .jobs.sync_race_dividends import sync_date as sync_div, sync_date_all_meets as sync_div_all
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


@app.command("backfill-dividends")
def cmd_backfill_dividends(
    months: int = typer.Option(6, help="과거 몇 개월치 백필 (races 기준)"),
    sleep: float = typer.Option(0.3, help="(date,meet) 호출 간격 (초)"),
) -> None:
    """[one-shot] race_dividends 1차 백필 — 최근 N개월 races 를 역순 순회.

    NOTE: API301 한 (date, meet) = ~30~60 page calls 이라 1회 실행에 일일 쿼터를
    초과할 수 있다. 정상 운영에선 `chunked-dividends-backfill` (야간 청크 잡) 를 사용.
    """
    from .jobs.backfill_dividends import backfill
    n = backfill(months=months, sleep_sec=sleep)
    typer.echo(f"backfilled {n} race_dividend rows")


@app.command("chunked-dividends-backfill")
def cmd_chunked_dividends_backfill(
    budget: int = typer.Option(15, help="이번 청크에서 호출할 최대 sync_date 수"),
    lookback_days: int = typer.Option(186, help="윈도우 (오늘 - N일)"),
) -> None:
    """[manual] race_dividends 야간 청크 1회 수동 실행 (스케줄러 02:30 KST 와 동일)."""
    from .jobs.chunked_backfill_dividends import run_chunk
    s = run_chunk(max_calls=budget, lookback_days=lookback_days)
    typer.echo(
        f"cursor={s['cursor']} next={s['next_cursor']} calls={s['calls']} "
        f"added={s['added_rows']} skipped_existing={s['skipped_existing']} "
        f"errors={s['errors']} quota_hit={s['quota_hit']} done={s['done']}"
    )


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


@app.command("periodic-horse-ratings")
def cmd_periodic_horse_ratings() -> None:
    """[scheduled] sync_horse_ratings — 주간 레이팅 공시."""
    n = run_sync_horse_ratings()
    typer.echo(f"upserted {n} horse_rating rows")


@app.command("register-dashboard-jobs")
def cmd_register_dashboard_jobs() -> None:
    """통합 크롤러 대시보드에 JOB_CATALOG 전체 idempotent 등록.

    컨테이너 entrypoint 에서 기동 시 한 번 호출 권장 — 대시보드 cold-start
    상태에서도 job 목록이 보이도록 미리 upsert.
    """
    register_all_jobs()
    typer.echo("dashboard jobs registered")


@app.command("check-stale")
def cmd_check_stale(
    multiplier: float = typer.Option(
        1.5, help="expected_interval_sec * multiplier 초과 시 stale 로 판정",
    ),
) -> None:
    """Stale job 탐지 + Discord 웹훅 전송. hourly 타이머로 호출."""
    stale = check_stale(multiplier=multiplier)
    if not stale:
        typer.echo("all jobs are fresh")
        return
    typer.echo(f"found {len(stale)} stale job(s):")
    for r in stale:
        typer.echo(f"  · {r['job_key']} (since_sec={int(r['since_sec'] or 0)})")


if __name__ == "__main__":
    app()
