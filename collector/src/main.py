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
from .jobs.sync_horses import backfill_missing_raw, sync_by_name, sync_by_no, upsert_horses
from .jobs.sync_jockeys import sync_all_jockeys
from .jobs.sync_news import smoke_news, sync_news
from .jobs.sync_race_info import sync_races_by_year
from .jobs.sync_races import sync_date, sync_date_all_meets
from .jobs.sync_videos import smoke_videos, sync_videos
from .logging import configure_logging, get_logger

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


if __name__ == "__main__":
    app()
