"""Sync per-race pool sales from KRA API179_1/salesAndDividendRate_1."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_sales import (
    RaceSalesClient,
    api_item_to_race_sales_fields,
)
from ..db import session_scope
from ..logging import get_logger
from ..models import RacePoolSales

log = get_logger(__name__)


def _is_valid(row: dict[str, Any]) -> bool:
    return (
        row.get("race_date") is not None
        and bool(row.get("meet"))
        and row.get("race_no") is not None
        and bool(row.get("pool"))
    )


def upsert_race_sales(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_race_sales_fields(it) for it in items]
    rows = [r for r in rows if _is_valid(r)]
    if not rows:
        return 0

    # 같은 PK 조합이 batch 안에서 두 번 등장하면 ON CONFLICT 가 같은 row 를
    # 두 번 갱신하려다 에러 → 마지막 값만 살린다.
    seen: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        key = (r["race_date"], r["meet"], r["race_no"], r["pool"])
        seen[key] = r
    unique = list(seen.values())

    stmt = pg_insert(RacePoolSales).values(unique)
    stmt = stmt.on_conflict_do_update(
        index_elements=[
            RacePoolSales.race_date,
            RacePoolSales.meet,
            RacePoolSales.race_no,
            RacePoolSales.pool,
        ],
        set_={
            "amount": stmt.excluded.amount,
            "odds_summary": stmt.excluded.odds_summary,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("race_sales_upserted", count=len(unique))
    return len(unique)


def sync_date(rc_date: date, *, meet: int | None = None) -> int:
    """특정 날짜 (옵션: 특정 경마장) 의 풀별 매출 적재."""
    with RaceSalesClient() as client:
        items = client.list_by_date(rc_date, meet=meet)
    log.info(
        "race_sales_fetched_date",
        date=rc_date.isoformat(),
        meet=meet,
        count=len(items),
    )
    return upsert_race_sales(items)


def sync_date_all_meets(rc_date: date) -> int:
    """전 경마장 합산 — 매일 결과 확정 후 cron 호출."""
    total = 0
    for meet in (1, 2, 3):
        try:
            total += sync_date(rc_date, meet=meet)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "race_sales_meet_failed",
                date=rc_date.isoformat(), meet=meet, err=str(e),
            )
    return total


def backfill_recent_days(days: int = 180) -> int:
    """최근 N 일 일자별 백필 — 1차 적재용 (수동 1회 실행)."""
    today = date.today()
    total = 0
    for i in range(days):
        d = today - timedelta(days=i)
        try:
            total += sync_date_all_meets(d)
        except Exception as e:  # noqa: BLE001
            log.warning("race_sales_backfill_day_failed", date=d.isoformat(), err=str(e))
    log.info("race_sales_backfill_done", days=days, upserted=total)
    return total
