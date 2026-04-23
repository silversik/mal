"""Sync trainers from KRA 조교사정보_영문추가 (API308) into `trainers` table."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.trainer import TrainerClient, api_item_to_trainer_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import Trainer

log = get_logger(__name__)


def upsert_trainers(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_trainer_fields(it) for it in items]
    rows = [r for r in rows if r["tr_no"] and r["tr_name"]]
    if not rows:
        return 0

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        if r["tr_no"] not in seen:
            seen.add(r["tr_no"])
            unique.append(r)

    stmt = pg_insert(Trainer).values(unique)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Trainer.tr_no],
        set_={
            "tr_name": stmt.excluded.tr_name,
            "tr_name_en": stmt.excluded.tr_name_en,
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

    log.info("trainers_upserted", count=len(unique))
    return len(unique)


def sync_all_trainers(meet: int | None = None) -> int:
    with TrainerClient() as client:
        items = client.list_all(meet=meet)
    log.info("trainers_fetched", meet=meet, count=len(items))
    return upsert_trainers(items)
