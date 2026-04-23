"""Sync jockey-change events from KRA API10_1/jockeyChangeInfo_1."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.jockey_change import (
    JockeyChangeClient,
    api_item_to_jockey_change_fields,
)
from ..db import session_scope
from ..logging import get_logger
from ..models import JockeyChange

log = get_logger(__name__)


def _is_valid(row: dict[str, Any]) -> bool:
    """KRA 응답이 가끔 빈/부분 row 를 섞어 보내므로 PK 컬럼 모두 유효한 것만."""
    return (
        row.get("race_date") is not None
        and bool(row.get("meet"))
        and row.get("race_no") is not None
        and row.get("chul_no") is not None
        and bool(row.get("horse_no"))
    )


def upsert_jockey_changes(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_jockey_change_fields(it) for it in items]
    rows = [r for r in rows if _is_valid(r)]
    if not rows:
        return 0

    # 같은 (race_date, meet, race_no, chul_no) 가 응답에 중복 등장하면
    # ON CONFLICT DO UPDATE 가 같은 batch 내에서 두 번 갱신을 시도해 에러 →
    # 마지막 등장하는 것만 남긴다 (KRA 가 가장 최신 reason 을 반환한다고 가정).
    seen: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        key = (r["race_date"], r["meet"], r["race_no"], r["chul_no"])
        seen[key] = r
    unique = list(seen.values())

    stmt = pg_insert(JockeyChange).values(unique)
    stmt = stmt.on_conflict_do_update(
        index_elements=[
            JockeyChange.race_date,
            JockeyChange.meet,
            JockeyChange.race_no,
            JockeyChange.chul_no,
        ],
        set_={
            "horse_no": stmt.excluded.horse_no,
            "horse_name": stmt.excluded.horse_name,
            "jk_no_before": stmt.excluded.jk_no_before,
            "jk_name_before": stmt.excluded.jk_name_before,
            "jk_no_after": stmt.excluded.jk_no_after,
            "jk_name_after": stmt.excluded.jk_name_after,
            "weight_before": stmt.excluded.weight_before,
            "weight_after": stmt.excluded.weight_after,
            "reason": stmt.excluded.reason,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("jockey_changes_upserted", count=len(unique))
    return len(unique)


def sync_recent() -> int:
    """필터 없이 KRA 기본 응답 (최근 ~1개월) 적재.

    일일 cron 에서 호출 — 이 호출 1회로 어제/오늘 변경분 모두 커버.
    """
    with JockeyChangeClient() as client:
        items = client.list_recent()
    log.info("jockey_changes_fetched_recent", count=len(items))
    return upsert_jockey_changes(items)


def sync_date(rc_date: date) -> int:
    """특정 날짜만 적재 — 백필/수동 보정용."""
    with JockeyChangeClient() as client:
        items = client.list_by_date(rc_date)
    log.info("jockey_changes_fetched_date", date=rc_date.isoformat(), count=len(items))
    return upsert_jockey_changes(items)


def backfill_recent_days(days: int = 180) -> int:
    """최근 N 일 일자별 백필 — 1차 적재용 (수동 1회 실행)."""
    today = date.today()
    total = 0
    for i in range(days):
        d = today - timedelta(days=i)
        try:
            total += sync_date(d)
        except Exception as e:  # noqa: BLE001
            log.warning("jockey_changes_backfill_day_failed", date=d.isoformat(), err=str(e))
    log.info("jockey_changes_backfill_done", days=days, upserted=total)
    return total
