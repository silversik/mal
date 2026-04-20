"""Sync jockeys from KRA 현직기수정보 into `jockeys` table."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.jockey import JockeyClient, api_item_to_jockey_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import Jockey

log = get_logger(__name__)


def upsert_jockeys(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_jockey_fields(it) for it in items]
    rows = [r for r in rows if r["jk_no"] and r["jk_name"]]
    if not rows:
        return 0

    stmt = pg_insert(Jockey).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Jockey.jk_no],
        set_={
            "jk_name": stmt.excluded.jk_name,
            "meet": stmt.excluded.meet,
            "birth_date": stmt.excluded.birth_date,
            "debut_date": stmt.excluded.debut_date,
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

    log.info("jockeys_upserted", count=len(rows))
    return len(rows)


def sync_all_jockeys(meet: int | None = None) -> int:
    with JockeyClient() as client:
        items = client.list_all(meet=meet)
    log.info("jockeys_fetched", meet=meet, count=len(items))
    return upsert_jockeys(items)
