"""Sync 대상경주 연간계획 → `race_plans` 테이블."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_annual_plan import RaceAnnualPlanClient, api_item_to_race_plan_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import RacePlan

log = get_logger(__name__)


def upsert_race_plans(items: list[dict[str, Any]]) -> int:
    rows = [r for r in items if r.get("race_name") and r.get("meet") and r.get("year")]
    if not rows:
        return 0

    # Dedup by unique key (meet, year, race_name) — 응답에 동일 race_name 이 회차별로
    # 여러 번 나올 수 있어 batch UPSERT 가 CardinalityViolation 을 터뜨린다.
    seen: set[tuple] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        key = (r["meet"], r["year"], r["race_name"])
        if key not in seen:
            seen.add(key)
            unique.append(r)
    rows = unique

    stmt = pg_insert(RacePlan).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_race_plans",
        set_={
            "race_date": stmt.excluded.race_date,
            "race_no": stmt.excluded.race_no,
            "grade": stmt.excluded.grade,
            "distance": stmt.excluded.distance,
            "track_type": stmt.excluded.track_type,
            "age_cond": stmt.excluded.age_cond,
            "prize_1st": stmt.excluded.prize_1st,
            "total_prize": stmt.excluded.total_prize,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("race_plans_upserted", count=len(rows))
    return len(rows)


def sync_year(year: int, *, meet: int | None = None) -> int:
    """Fetch year plan for given meet (None = all 3)."""
    meets = [meet] if meet is not None else [1, 2, 3]
    total = 0
    with RaceAnnualPlanClient() as client:
        for m in meets:
            items = client.list_by_year(year, meet=m)
            log.info("race_plan_fetched", year=year, meet=m, count=len(items))
            mapped = [api_item_to_race_plan_fields(it, year=year) for it in items]
            total += upsert_race_plans(mapped)
    return total


def sync_current_year() -> int:
    return sync_year(date.today().year)
