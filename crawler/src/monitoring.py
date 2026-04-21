"""Scraper run tracking + Discord failure notifications.

Usage:
    @track_job("sync_news")
    def sync_news() -> int:
        ...

The decorator records a `scraper_runs` row at entry (status=running) and
updates it on exit with success/failed + duration + upserted count + error.
On failure, posts a summary to DISCORD_WEBHOOK_URL if configured.

A separate `check_stale()` helper scans `scraper_jobs` for jobs whose
`last_success_at` exceeds `expected_interval_sec * 1.5` and posts a single
digest message — wire it to systemd timer at e.g. hourly cadence.
"""
from __future__ import annotations

import os
import time
import traceback
from collections.abc import Callable
from datetime import UTC, datetime
from functools import wraps
from typing import ParamSpec, TypeVar

import httpx
from sqlalchemy import select, text

from .db import session_scope
from .logging import get_logger
from .models import ScraperJob, ScraperRun

log = get_logger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
ERROR_SNIPPET_MAX = 500


def _notify_discord(title: str, body: str) -> None:
    """Fire-and-forget Discord webhook. Silent no-op if env var missing."""
    if not DISCORD_WEBHOOK_URL:
        return
    content = f"**{title}**\n```\n{body[:1800]}\n```"
    try:
        with httpx.Client(timeout=5.0) as client:
            client.post(DISCORD_WEBHOOK_URL, json={"content": content})
    except Exception as e:
        log.warning("discord_notify_failed", error=str(e))


def track_job(job_key: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Wrap a sync function to record its run in `scraper_runs`.

    The wrapped function's return value — if it is an int — is stored as
    `rows_upserted`. Any exception updates the row to status=failed, fires a
    Discord alert, and is re-raised.
    """

    def decorator(fn: Callable[P, R]) -> Callable[P, R]:
        @wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            run_id = _insert_running(job_key)
            t0 = time.monotonic()
            try:
                result = fn(*args, **kwargs)
            except Exception as exc:
                duration_ms = int((time.monotonic() - t0) * 1000)
                err = f"{type(exc).__name__}: {exc}"
                tb = traceback.format_exc()
                _finish_run(
                    run_id,
                    status="failed",
                    rows_upserted=None,
                    duration_ms=duration_ms,
                    error_message=(err + "\n\n" + tb)[:4000],
                )
                _notify_discord(
                    title=f"❌ {job_key} 실패",
                    body=err[:ERROR_SNIPPET_MAX],
                )
                raise
            else:
                duration_ms = int((time.monotonic() - t0) * 1000)
                rows = result if isinstance(result, int) else None
                _finish_run(
                    run_id,
                    status="success",
                    rows_upserted=rows,
                    duration_ms=duration_ms,
                    error_message=None,
                )
                return result

        return wrapper

    return decorator


def _insert_running(job_key: str) -> int:
    now = datetime.now(tz=UTC)
    with session_scope() as s:
        # scraper_jobs 메타가 없으면 FK 위반이 나므로 안전하게 확인.
        job = s.get(ScraperJob, job_key)
        if job is None:
            raise RuntimeError(
                f"scraper_jobs row missing for '{job_key}' — run migration 006 "
                f"or insert the job row first."
            )
        run = ScraperRun(
            job_key=job_key,
            started_at=now,
            status="running",
        )
        s.add(run)
        s.flush()
        return run.id


def _finish_run(
    run_id: int,
    *,
    status: str,
    rows_upserted: int | None,
    duration_ms: int,
    error_message: str | None,
) -> None:
    now = datetime.now(tz=UTC)
    with session_scope() as s:
        run = s.get(ScraperRun, run_id)
        if run is None:
            log.warning("scraper_run_missing", run_id=run_id)
            return
        run.finished_at = now
        run.status = status
        run.rows_upserted = rows_upserted
        run.duration_ms = duration_ms
        run.error_message = error_message


def check_stale(*, multiplier: float = 1.5) -> list[dict]:
    """enabled=true 인 job 중 마지막 성공이 expected_interval * multiplier 초과한 것을 찾아
    Discord 로 digest 전송. 반환: 알림 대상 job 리스트.
    """
    sql = text(
        """
        SELECT j.job_key,
               j.source,
               j.description,
               j.expected_interval_sec,
               last.last_success_at,
               EXTRACT(EPOCH FROM (NOW() - last.last_success_at)) AS since_sec
          FROM scraper_jobs j
          LEFT JOIN LATERAL (
                SELECT MAX(finished_at) FILTER (WHERE status = 'success') AS last_success_at
                  FROM scraper_runs
                 WHERE job_key = j.job_key
          ) last ON TRUE
         WHERE j.enabled = TRUE
           AND (
                last.last_success_at IS NULL
                OR EXTRACT(EPOCH FROM (NOW() - last.last_success_at))
                   > j.expected_interval_sec * :mult
           )
        """
    )
    with session_scope() as s:
        rows = s.execute(sql, {"mult": multiplier}).mappings().all()

    stale = [dict(r) for r in rows]
    if not stale:
        log.info("check_stale_ok")
        return []

    log.warning("check_stale_found", count=len(stale))
    lines = []
    for r in stale:
        since = r["since_sec"]
        since_str = f"{int(since // 3600)}h" if since else "never"
        lines.append(
            f"- {r['job_key']} ({r['source']}): 마지막 성공 {since_str} 전 "
            f"(기대 주기 {r['expected_interval_sec']}s)"
        )
    _notify_discord(
        title=f"⚠️ 스크래퍼 {len(stale)}건 지연",
        body="\n".join(lines),
    )
    return stale


def list_enabled_jobs() -> list[ScraperJob]:
    with session_scope() as s:
        return list(s.execute(select(ScraperJob).where(ScraperJob.enabled)).scalars())
