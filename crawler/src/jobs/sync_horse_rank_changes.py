"""Sync horse rank-change events from KRA raceHorseRatingChangeInfo_2."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.horse_rank_change import (
    HorseRankChangeClient,
    api_item_to_horse_rank_change_fields,
)
from ..db import session_scope
from ..logging import get_logger
from ..models import HorseRankChange

log = get_logger(__name__)


def _is_valid(row: dict[str, Any]) -> bool:
    return bool(row.get("horse_no")) and row.get("st_date") is not None


def upsert_horse_rank_changes(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_horse_rank_change_fields(it) for it in items]
    rows = [r for r in rows if _is_valid(r)]
    if not rows:
        return 0

    # 같은 (horse_no, st_date) 가 응답 batch 내 중복이면 마지막 것만 살림.
    seen: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        key = (r["horse_no"], r["st_date"])
        seen[key] = r
    unique = list(seen.values())

    stmt = pg_insert(HorseRankChange).values(unique)
    stmt = stmt.on_conflict_do_update(
        index_elements=[HorseRankChange.horse_no, HorseRankChange.st_date],
        set_={
            "horse_name": stmt.excluded.horse_name,
            "meet": stmt.excluded.meet,
            "blood": stmt.excluded.blood,
            "before_rank": stmt.excluded.before_rank,
            "after_rank": stmt.excluded.after_rank,
            "sp_date": stmt.excluded.sp_date,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("horse_rank_changes_upserted", count=len(unique))
    return len(unique)


def sync_all() -> int:
    """전체 등급변동 이력을 KRA 에서 일괄 fetch & UPSERT.

    누적 row 가 ~5000 / 페이지 200 기준 ~25 page 호출. 일일 cron 1회로 충분.
    """
    with HorseRankChangeClient() as client:
        items = client.list_all()
    log.info("horse_rank_changes_fetched", count=len(items))
    return upsert_horse_rank_changes(items)
