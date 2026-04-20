"""Sync horses from KRA API42_1 into `horses` table using UPSERT."""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.horse_detail import HorseDetailClient, api_item_to_horse_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import Horse

log = get_logger(__name__)


def upsert_horses(items: list[dict[str, Any]]) -> int:
    """UPSERT a batch of API items. Returns inserted+updated row count."""
    rows = [api_item_to_horse_fields(it) for it in items]
    rows = [r for r in rows if r["horse_no"] and r["horse_name"]]
    if not rows:
        return 0

    stmt = pg_insert(Horse).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Horse.horse_no],
        set_={
            "horse_name": stmt.excluded.horse_name,
            "country": stmt.excluded.country,
            "sex": stmt.excluded.sex,
            "birth_date": stmt.excluded.birth_date,
            "sire_name": stmt.excluded.sire_name,
            "dam_name": stmt.excluded.dam_name,
            "total_race_count": stmt.excluded.total_race_count,
            "first_place_count": stmt.excluded.first_place_count,
            "coat_color": stmt.excluded.coat_color,
            "characteristics": stmt.excluded.characteristics,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("horses_upserted", count=len(rows))
    return len(rows)


def sync_by_name(horse_name: str, *, meet: int | None = None) -> int:
    """Fetch horses matching `horse_name` from KRA and upsert."""
    with HorseDetailClient() as client:
        items = client.search_by_name(horse_name, meet=meet)
    log.info("horses_fetched", name=horse_name, meet=meet, count=len(items))
    return upsert_horses(items)


def sync_by_no(horse_no: str, *, meet: int | None = None) -> int:
    with HorseDetailClient() as client:
        item = client.get_by_no(horse_no, meet=meet)
    if not item:
        log.warning("horse_not_found", horse_no=horse_no)
        return 0
    return upsert_horses([item])


def backfill_missing_raw(
    limit: int | None = None, sleep_sec: float = 0.15
) -> int:
    """`raw` 가 비어있는 마필을 API42_1 으로 재조회해 UPSERT.

    최초 시드(경주결과에서 side-effect 로 생성된 horses row) 들은 raw/모색/특징이
    NULL 이므로, 이 함수로 메꾼다. 호출 간 `sleep_sec` 간격으로 API rate-limit 보호.
    """
    # `raw` 가 SQL NULL 이거나 JSONB null 리터럴인 두 케이스 모두 대상.
    missing = or_(Horse.raw.is_(None), text("jsonb_typeof(raw) <> 'object'"))
    with session_scope() as s:
        stmt = (
            select(Horse.horse_no)
            .where(missing)
            .order_by(Horse.horse_no)
        )
        if limit:
            stmt = stmt.limit(limit)
        horse_nos = list(s.execute(stmt).scalars())

    if not horse_nos:
        log.info("backfill_nothing_to_do")
        return 0

    log.info("backfill_start", pending=len(horse_nos))
    count = 0
    with HorseDetailClient() as client:
        for idx, hr_no in enumerate(horse_nos, 1):
            try:
                item = client.get_by_no(hr_no)
            except Exception as e:
                log.warning("backfill_fetch_failed", horse_no=hr_no, err=str(e))
                continue
            if not item:
                log.warning("backfill_horse_not_found", horse_no=hr_no)
                continue
            count += upsert_horses([item])
            if idx % 25 == 0:
                log.info("backfill_progress", done=idx, total=len(horse_nos))
            if sleep_sec:
                time.sleep(sleep_sec)
    log.info("backfill_done", upserted=count, total=len(horse_nos))
    return count
