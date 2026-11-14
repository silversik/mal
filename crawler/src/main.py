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
from datetime import date, datetime
from types import TracebackType

import typer

from .clients.horse_detail import HorseDetailClient
from .jobs.periodic import (
    run_chunked_dividends_backfill,
    run_publish_racing_form,
    run_settle_racing_form,
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


@app.command("periodic-publish-racing-form")
def cmd_periodic_publish_racing_form() -> None:
    """[scheduled] publish_racing_form — tracked run (잡 규칙 그대로, 별도 발행 경로 아님)."""
    n = run_publish_racing_form()
    typer.echo(f"published {n} racing_form editions")


@app.command("periodic-settle-racing-form")
def cmd_periodic_settle_racing_form() -> None:
    """[scheduled] settle_racing_form — tracked run."""
    n = run_settle_racing_form()
    typer.echo(f"settled {n} racing_form outcome rows")


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


# ============================================================================
# 경마지 (racing form) — 운영자 CLI (docs/feature/racing-form.md 9.3).
# 발행 명령은 없다 — 발행은 잡 규칙 하나뿐 (mal.publish_racing_form · periodic-publish-racing-form).
# 무거운 모듈은 명령 안에서 import 한다. 시각은 여기서 KST 로 읽어 넘긴다.
# ============================================================================


def _kst_now() -> datetime:
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("Asia/Seoul"))


def _rf_day(value: str) -> date:
    from .racing_form.ops import parse_day

    try:
        return parse_day(value)
    except ValueError as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(code=2) from None


def _rf_meet(value: str) -> str:
    from .racing_form.ops import parse_meet

    try:
        return parse_meet(value)
    except ValueError as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(code=2) from None


def _git_rev() -> str | None:
    """holdout 기록용 코드 리비전 — git 이 있으면 HEAD (컨테이너엔 없음 → None)."""
    import subprocess
    from pathlib import Path

    try:
        out = subprocess.run(
            ["git", "-C", str(Path(__file__).resolve().parent), "rev-parse", "--short=12", "HEAD"],
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    rev = out.stdout.strip()
    return rev or None


@app.command("racing-form-build")
def cmd_racing_form_build(
    race_date: str = typer.Argument(..., help="경주일 (YYYY-MM-DD 또는 YYYYMMDD)"),
    meet: str = typer.Argument(..., help="서울·부경·제주 (또는 seoul·busan·jeju)"),
    mode: str = typer.Option("live", "--mode", help="live | replay"),
    json_output: bool = typer.Option(False, "--json", help="meta·payload 전체를 JSON 으로"),
) -> None:
    """[racing-form] 한 호를 계산해 출력만 (dry-run, READ ONLY — 쓰지 않음).

    live 의 발행 창·D 결과 검사는 경고로만 남긴다. 데이터 가드 실패면 exit 1.
    """
    from .racing_form import ops

    d, m = _rf_day(race_date), _rf_meet(meet)
    if mode not in ops.BUILD_MODES:
        typer.echo(f"--mode 는 live 또는 replay ({mode!r})", err=True)
        raise typer.Exit(code=2)
    run_ = ops.dry_run_build(d, m, _kst_now(), mode=mode)
    typer.echo(ops.render_build_json(run_) if json_output else ops.render_build_text(run_))
    raise typer.Exit(code=1 if run_.error_code else 0)


@app.command("racing-form-show")
def cmd_racing_form_show(
    race_date: str = typer.Argument(..., help="경주일 (YYYY-MM-DD 또는 YYYYMMDD)"),
    meet: str = typer.Argument(..., help="서울·부경·제주 (또는 seoul·busan·jeju)"),
) -> None:
    """[racing-form] 저장된 발행본·정산·공지 요약 (READ ONLY). 발행본이 없으면 exit 1."""
    from .racing_form import ops

    out, found = ops.show_edition(_rf_day(race_date), _rf_meet(meet))
    typer.echo(out)
    raise typer.Exit(code=0 if found else 1)


@app.command("racing-form-settle")
def cmd_racing_form_settle(
    race_date: str | None = typer.Option(
        None, "--date", help="이 경주일 발행본만 (생략 시 잡과 같이 오늘−14 ~ 오늘)"
    ),
) -> None:
    """[racing-form] 정산 잡과 같은 규칙으로 1회 정산 (now = 지금 KST). 실패가 있으면 exit 1."""
    from .racing_form import ops

    d = _rf_day(race_date) if race_date else None
    n, failures = ops.settle_once(_kst_now(), d=d)
    typer.echo(f"정산 {n}행 기록 · 실패 {len(failures)}")
    for f in failures:
        typer.echo(f"  - {redact(f)}")
    raise typer.Exit(code=1 if failures else 0)


@app.command("racing-form-backtest")
def cmd_racing_form_backtest(
    date_from: str = typer.Option(..., "--from", help="시작 경주일 (포함)"),
    date_to: str = typer.Option(..., "--to", help="끝 경주일 (포함, 어제까지)"),
    meet: list[str] | None = typer.Option(  # noqa: B008 — typer 다중 옵션은 list 여야 한다
        None, "--meet", help="경마장 (여러 번 가능, 생략 시 서울·부경·제주)"
    ),
    label: str = typer.Option(..., "--label", help="dev (읽기 전용) | holdout (저장 필수, 1회)"),
    save: bool = typer.Option(False, "--save", help="보고서 저장 — holdout 만 (필수)"),
    public: bool = typer.Option(
        False, "--public", help="저장 행을 공개로 (/form/record) — 나중에 바꿀 수 없음"
    ),
    json_output: bool = typer.Option(False, "--json", help="보고서 JSON 전체"),
    rules_version: str | None = typer.Option(
        None, "--rules-version", help="후보 기준 버전 (생략 시 ACTIVE)"
    ),
    code_rev: str | None = typer.Option(
        None, "--code-rev", help="코드 리비전 (holdout 기록용, 생략 시 git HEAD 시도)"
    ),
) -> None:
    """[racing-form] 과거 시험 — dev 는 쓰지 않고, holdout 은 정의 해시당 1회 저장한 뒤 출력.

    명단은 결과표 출주(Q1b), 월 단위 READ ONLY. ensure_rule_set 을 부르지 않는다.
    """
    import json as _json

    from .racing_form import backtest, definitions

    d_from, d_to = _rf_day(date_from), _rf_day(date_to)
    meets = [_rf_meet(m) for m in meet] if meet else None
    version = rules_version or definitions.ACTIVE
    defn = definitions.RULE_SETS.get(version)
    if defn is None:
        typer.echo(f"모르는 기준 버전: {version!r}", err=True)
        raise typer.Exit(code=2)
    rev = code_rev or (_git_rev() if save else None)
    try:
        report = backtest.run_backtest(
            None, defn, d_from, d_to, meets, label, _kst_now(),
            save=save, public=public, code_rev=rev,
        )
    except backtest.HoldoutExists as e:
        typer.echo(f"거부: {e}", err=True)
        raise typer.Exit(code=1) from None
    except backtest.BacktestError as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(code=2) from None
    if save:
        typer.echo(
            f"{label} 보고서 저장됨 — {defn.version} 정의 {report['definition_sha256'][:12]} · "
            f"공개 {'예' if public else '아니오'} · code_rev {rev or '-'}",
            err=True,
        )
    if json_output:
        typer.echo(_json.dumps(report, ensure_ascii=False, indent=2))
    else:
        typer.echo(backtest.render_text(report))


@app.command("racing-form-preflight")
def cmd_racing_form_preflight(
    json_output: bool = typer.Option(False, "--json", help="표 대신 JSON 으로 출력"),
) -> None:
    """[racing-form] 출시 전 읽기 전용 감사 18항목 (쿼리마다 READ ONLY, 15초/2초).

    exit 0 = FAIL 없음 (WARN 은 사람이 판단), 1 = 점검 실패 또는 출시 불가 조건.
    prod: `docker exec mal-crawler python -m src.main racing-form-preflight`.
    """
    from . import db as _db
    from .racing_form import preflight

    out, code = preflight.run_cli(_db.engine, _kst_now(), json_output=json_output)
    typer.echo(out)
    raise typer.Exit(code=code)


@app.command("racing-form-verify")
def cmd_racing_form_verify(
    max_clock_skew_min: int = typer.Option(
        5, "--max-clock-skew-min", help="|created_at − published_at| 허용 (분)"
    ),
) -> None:
    """[racing-form] 무결성 점검 (READ ONLY) — payload 해시 SQL 재계산, DB 시계 vs 잡 시계,
    보호 트리거 12개·ALWAYS, 기준 정의 해시 vs 레지스트리, 예상 행 = payload. 문제가 있으면 exit 1.
    """
    from datetime import timedelta

    from .racing_form import verify

    report = verify.run_verify(None, max_clock_skew=timedelta(minutes=max_clock_skew_min))
    typer.echo(verify.render_text(report))
    raise typer.Exit(code=0 if report.ok else 1)


@app.command("racing-form-notice")
def cmd_racing_form_notice(
    kind: str = typer.Option(..., "--kind", help="erratum | withdrawn | paused"),
    race_date: str = typer.Option(..., "--date", help="경주일 (paused 는 시작일)"),
    meet: str | None = typer.Option(
        None, "--meet", help="경마장 (erratum·withdrawn 필수, paused 는 생략 = 전체)"
    ),
    until: str | None = typer.Option(None, "--until", help="paused 종료일 (그날 포함, 필수)"),
    public_text: str = typer.Option(..., "--text", help="공개 문구 — 사실만, 그대로 노출된다"),
    hide_picks: bool = typer.Option(
        False, "--hide-picks", help="withdrawn 법적 사유일 때만 — 화면에서 예상을 숨김"
    ),
) -> None:
    """[racing-form] 운영자 공지 추가 (추가 전용 — 지울 수 없다). 철회해도 기록에 포함된다."""
    from .racing_form import ops

    d = _rf_day(race_date)
    m = _rf_meet(meet) if meet else None
    u = _rf_day(until) if until else None
    try:
        res = ops.add_operator_notice(
            kind=kind, d=d, meet=m, public_text=public_text, now=_kst_now(),
            until=u, hide_picks=hide_picks,
        )
    except ValueError as e:
        typer.echo(str(e), err=True)
        raise typer.Exit(code=2) from None
    if res.inserted:
        typer.echo(
            f"공지 추가됨 — {res.kind} {d.isoformat()} {m or '전체'}"
            + (f" (호 {res.edition_id})" if res.edition_id else "")
            + f" · dedup_key {res.dedup_key}"
        )
    for msg in res.messages:
        typer.echo(msg)


if __name__ == "__main__":
    run()
