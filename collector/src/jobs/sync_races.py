"""Sync race results from KRA 경주별상세성적표 into `race_results` table."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_result import RaceResultClient, api_item_to_race_result_fields
from ..db import session_scope
from ..jobs.sync_horses import backfill_missing_raw, upsert_horses
from ..jobs.sync_race_info import backfill_races_from_results
from ..logging import get_logger
from ..models import RaceResult

log = get_logger(__name__)


def upsert_race_results(items: list[dict[str, Any]]) -> int:
    """UPSERT a batch of API items into `race_results`. Returns row count."""
    rows = [api_item_to_race_result_fields(it) for it in items]
    rows = [r for r in rows if r["horse_no"] and r["race_date"] and r["race_no"] is not None]
    if not rows:
        return 0

    # Deduplicate by unique key to avoid CardinalityViolation in batch upsert
    seen: set[tuple] = set()
    unique_rows: list[dict[str, Any]] = []
    for r in rows:
        key = (r["horse_no"], str(r["race_date"]), r["meet"], r["race_no"])
        if key not in seen:
            seen.add(key)
            unique_rows.append(r)
    rows = unique_rows

    stmt = pg_insert(RaceResult).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_race_results",
        set_={
            "track_condition": stmt.excluded.track_condition,
            "rank": stmt.excluded.rank,
            "record_time": stmt.excluded.record_time,
            "weight": stmt.excluded.weight,
            "jockey_name": stmt.excluded.jockey_name,
            "trainer_name": stmt.excluded.trainer_name,
            "raw": stmt.excluded.raw,
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("race_results_upserted", count=len(rows))
    return len(rows)


def _ensure_horses_exist(items: list[dict[str, Any]]) -> None:
    """Create minimal horse records for any horse_no not yet in the DB.

    This avoids FK violations when race results reference horses that
    haven't been fetched via API42_1 yet. The record is minimal —
    it will be enriched when the full horse sync runs later.
    """
    minimal: list[dict[str, Any]] = []
    for it in items:
        hr_no = str(it.get("hrNo") or "").strip()
        hr_name = str(it.get("hrName") or "").strip()
        if hr_no and hr_name:
            minimal.append({
                "horse_no": hr_no,
                "horse_name": hr_name,
                "sex": it.get("sex") or None,
                "raw": None,
            })

    if not minimal:
        return

    from ..models import Horse

    stmt = pg_insert(Horse).values(minimal)
    stmt = stmt.on_conflict_do_nothing(index_elements=[Horse.horse_no])

    with session_scope() as s:
        s.execute(stmt)

    log.info("horses_ensured", count=len(minimal))


def sync_date(rc_date: date, meet: int) -> int:
    """Fetch all race results for a given (date, meet) and upsert.

    Also backfills the `races` table for that date so the web app has
    race-level rows even when API187 metadata is unavailable.
    """
    with RaceResultClient() as client:
        items = client.list_by_date(rc_date, meet=meet)

    log.info("race_results_fetched", date=str(rc_date), meet=meet, count=len(items))
    if not items:
        return 0

    _ensure_horses_exist(items)
    n = upsert_race_results(items)
    backfill_races_from_results()
    return n


def sync_date_all_meets(rc_date: date) -> int:
    """Sync all 3 meets (서울/제주/부경) for a given date, then backfill `races`.

    스텁으로 삽입된 새 마필(raw NULL)이 있다면 API42_1 으로 enrich 해 모색/특징까지
    채워둔다 — 아바타에 색이 누락되는 일을 방지.
    """
    total = 0
    for meet in (1, 2, 3):
        total += sync_date(rc_date, meet=meet)
    backfill_races_from_results()
    backfill_missing_raw()
    return total
