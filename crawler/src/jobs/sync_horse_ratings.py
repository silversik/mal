"""Sync 경주마 레이팅 (15057323) → `horse_ratings` 테이블.

API 응답에 공시일자가 없으므로 fetch 시점(`snapshot_date = CURRENT_DATE`)을
PK 의 일부로 묶어 시계열 누적. 같은 날 재실행은 update, 다른 날은 새 row insert.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.horse_rating import HorseRatingClient, api_item_to_rating_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import HorseRating

log = get_logger(__name__)


_UPDATE_COLS = (
    "horse_name",
    "meet",
    "rating1",
    "rating2",
    "rating3",
    "rating4",
    "raw",
)


# 8 columns / row × _BATCH < 65535 (psycopg 파라미터 한계)
_BATCH = 2000


def upsert_ratings(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_rating_fields(it) for it in items]
    rows = [r for r in rows if r and r.get("horse_no")]
    if not rows:
        return 0

    # 같은 호출 안에서 horse_no 중복 시 마지막 값 채택.
    dedup: dict[str, dict[str, Any]] = {}
    for r in rows:
        dedup[r["horse_no"]] = r
    unique = list(dedup.values())

    with session_scope() as s:
        for i in range(0, len(unique), _BATCH):
            chunk = unique[i : i + _BATCH]
            stmt = pg_insert(HorseRating).values(chunk)
            set_ = {c: getattr(stmt.excluded, c) for c in _UPDATE_COLS}
            set_["fetched_at"] = func.now()
            set_["updated_at"] = func.now()
            # snapshot_date 는 server_default = CURRENT_DATE 로 자동 채워짐.
            # 같은 날 재실행은 (horse_no, snapshot_date) 에서 충돌 → update,
            # 다른 날은 신규 row insert (시계열 누적).
            stmt = stmt.on_conflict_do_update(
                index_elements=["horse_no", "snapshot_date"], set_=set_,
            )
            s.execute(stmt)
    log.info("horse_ratings_upserted", count=len(unique))
    return len(unique)


def sync_meet(meet: int | None = None) -> int:
    """레이팅 일괄 fetch → upsert. API77 은 meet 파라미터에 관계없이 전체를 반환."""
    with HorseRatingClient() as client:
        items = client.list_all(meet=meet)
    log.info("horse_ratings_fetched", meet=meet, count=len(items))
    if not items:
        return 0
    return upsert_ratings(items)


def sync_all_meets() -> int:
    """매주 1회 스케줄 — API77 은 meet 무관하게 전체 17K row 를 반환하므로 단일 호출."""
    return sync_meet(None)
