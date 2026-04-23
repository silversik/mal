"""Sync 확정배당율 (API301) → `race_dividends` 테이블.

경주 결과가 확정된 뒤에만 배당이 고정되므로, 보통 경주 당일 저녁~다음 날 새벽에
호출한다. 스케줄러는 `run_sync_race_results_today` (22:00) 직후에 배치.

WIN/PLC pool 만 적재 — horse-level (race_date, meet, race_no, horse_no) 한 row.
복식 (QNL/QPL/EXA/TRI/TLA) 은 1차 범위 외 (별도 후속 이터레이션).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_dividend import RaceDividendClient, items_to_dividend_rows
from ..db import session_scope
from ..logging import get_logger
from ..models import RaceDividend

log = get_logger(__name__)


_UPDATE_COLS = ("win_rate", "plc_rate", "raw_win", "raw_plc")


def upsert_race_dividends(items: list[dict[str, Any]]) -> int:
    rows = items_to_dividend_rows(items)
    if not rows:
        return 0

    stmt = pg_insert(RaceDividend).values(rows)
    set_ = {c: getattr(stmt.excluded, c) for c in _UPDATE_COLS}
    set_["fetched_at"] = func.now()
    set_["updated_at"] = func.now()
    stmt = stmt.on_conflict_do_update(constraint="uq_race_dividends", set_=set_)

    with session_scope() as s:
        s.execute(stmt)
    log.info("race_dividends_upserted", count=len(rows))
    return len(rows)


def sync_date(rc_date: date, meet: int) -> int:
    with RaceDividendClient() as client:
        items = client.list_by_date(rc_date, meet=meet)
    log.info("race_dividends_fetched", date=str(rc_date), meet=meet, count=len(items))
    if not items:
        return 0
    return upsert_race_dividends(items)


def sync_date_all_meets(rc_date: date) -> int:
    total = 0
    for meet in (1, 2, 3):
        total += sync_date(rc_date, meet=meet)
    return total
