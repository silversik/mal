"""Sync 확정배당율 (API301) → `race_dividends` (단·연) + `race_combo_dividends` (복식).

경주 결과가 확정된 뒤에만 배당이 고정되므로, 보통 경주 당일 저녁~다음 날 새벽에
호출한다. 스케줄러는 `run_sync_race_results_today` (22:00) 직후에 배치.

API 호출 1회 (per date+meet) 의 응답에서:
    WIN/PLC                → race_dividends      (horse-level row)
    QNL/QPL/EXA/TRI/TLA   → race_combo_dividends (combo-level row)
양쪽 테이블에 같은 트랜잭션으로 upsert (호출 비용 절약).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_dividend import (
    RaceDividendClient,
    items_to_combo_dividend_rows,
    items_to_dividend_rows,
)
from ..db import session_scope
from ..logging import get_logger
from ..models import RaceComboDividend, RaceDividend

log = get_logger(__name__)


_UPDATE_COLS = ("win_rate", "plc_rate", "raw_win", "raw_plc")
_COMBO_UPDATE_COLS = ("horse_no_1", "horse_no_2", "horse_no_3", "odds", "raw")


def upsert_race_dividends(items: list[dict[str, Any]]) -> int:
    """단·연 (WIN/PLC) + 복식 (QNL/QPL/EXA/TRI/TLA) 모두 upsert. 반환=horse-level row 수."""
    horse_rows = items_to_dividend_rows(items)
    combo_rows = items_to_combo_dividend_rows(items)

    with session_scope() as s:
        if horse_rows:
            stmt = pg_insert(RaceDividend).values(horse_rows)
            set_ = {c: getattr(stmt.excluded, c) for c in _UPDATE_COLS}
            set_["fetched_at"] = func.now()
            set_["updated_at"] = func.now()
            stmt = stmt.on_conflict_do_update(
                constraint="uq_race_dividends", set_=set_,
            )
            s.execute(stmt)
        if combo_rows:
            cstmt = pg_insert(RaceComboDividend).values(combo_rows)
            cset = {c: getattr(cstmt.excluded, c) for c in _COMBO_UPDATE_COLS}
            cset["fetched_at"] = func.now()
            cset["updated_at"] = func.now()
            cstmt = cstmt.on_conflict_do_update(
                constraint="uq_race_combo_dividends", set_=cset,
            )
            s.execute(cstmt)

    log.info(
        "race_dividends_upserted",
        horse_count=len(horse_rows),
        combo_count=len(combo_rows),
    )
    return len(horse_rows)


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
