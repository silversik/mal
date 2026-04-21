"""Bulk historical backfill — 날짜 범위를 순회해 race_results + horses 를 전부 채운다.

프로덕션 콜드스타트용. `sync_date_all_meets` 를 그대로 재사용하므로:
  1. 해당 날짜의 3개 경마장 경주결과 upsert (`race_results`)
  2. `_ensure_horses_exist` 로 스텁 horses INSERT (raw=NULL)
  3. `backfill_missing_raw()` 가 스텁을 API42_1 으로 enrich

전부 upsert 라서 중도 실패 → 재실행 idempotent. 단건 실패 (KRA 5xx) 는 무시하고 계속.
"""
from __future__ import annotations

import time
from datetime import date, timedelta

from ..logging import get_logger
from ..monitoring import track_job
from .sync_races import sync_date_all_meets

log = get_logger(__name__)


def _iter_dates(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def backfill_history(start: date, end: date, sleep_sec: float = 0.3) -> int:
    """Iterate [start, end] inclusive. Returns total race_result rows upserted."""
    total = 0
    errors = 0
    days = (end - start).days + 1
    log.info("backfill_history_start", start=str(start), end=str(end), days=days)

    for idx, d in enumerate(_iter_dates(start, end), 1):
        try:
            n = sync_date_all_meets(d)
            total += n
        except Exception as e:  # noqa: BLE001
            errors += 1
            log.warning("backfill_day_failed", date=str(d), err=str(e))

        if idx % 30 == 0:
            log.info(
                "backfill_progress",
                done=idx, total=days, errors=errors, rows_so_far=total,
            )

        if sleep_sec:
            time.sleep(sleep_sec)

    log.info("backfill_history_done", total_rows=total, errors=errors, days=days)
    return total


@track_job("mal.backfill_history")
def run_backfill_last_33y() -> int:
    """One-shot: 최근 33년 (오늘 포함 X). 수동 트리거 (CLI / 대시보드) 전용."""
    today = date.today()
    start = today.replace(year=today.year - 33)
    return backfill_history(start, today - timedelta(days=1))
