"""Sync owners from KRA 마주정보_영문추가 (API309) into `owners` table."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.owner import OwnerClient, api_item_to_owner_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import Owner

log = get_logger(__name__)


def upsert_owners(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_owner_fields(it) for it in items]
    rows = [r for r in rows if r["ow_no"] and r["ow_name"]]
    if not rows:
        return 0

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        if r["ow_no"] not in seen:
            seen.add(r["ow_no"])
            unique.append(r)

    stmt = pg_insert(Owner).values(unique)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Owner.ow_no],
        set_={
            "ow_name": stmt.excluded.ow_name,
            "ow_name_en": stmt.excluded.ow_name_en,
            "meet": stmt.excluded.meet,
            "reg_date": stmt.excluded.reg_date,
            "total_race_count": stmt.excluded.total_race_count,
            "first_place_count": stmt.excluded.first_place_count,
            "second_place_count": stmt.excluded.second_place_count,
            "third_place_count": stmt.excluded.third_place_count,
            "win_rate": stmt.excluded.win_rate,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("owners_upserted", count=len(unique))
    return len(unique)


def sync_all_owners(meet: int | None = None) -> int:
    with OwnerClient() as client:
        items = client.list_all(meet=meet)
    log.info("owners_fetched", meet=meet, count=len(items))
    return upsert_owners(items)
