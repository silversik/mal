"""Sync per-horse corner orders from KRA API4_2/raceResult_2.

race_results 와 1:1 매칭되는 통과순위·구간기록 별도 테이블 적재.
mal.kr 의 페이스 맵 (B-1) 의존.

KRA meet 코드 1=서울, 2=제주, 3=부경 — race_result.py 와 동일.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_result_corner import (
    RaceResultCornerClient,
    api_item_to_corner_fields,
)
from ..db import session_scope
from ..logging import get_logger
from ..models import RaceResultCorner

log = get_logger(__name__)

_MEET_NAMES = {"1": "서울", "2": "제주", "3": "부경"}


def _normalize_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """API4_2 응답 1건을 race_result_corners row 형태로 정규화."""
    if not row.get("horse_no") or not row.get("race_no") or not row.get("race_date"):
        return None

    rd_raw = str(row["race_date"])
    if len(rd_raw) == 8:
        rd = date(int(rd_raw[:4]), int(rd_raw[4:6]), int(rd_raw[6:8]))
    else:
        try:
            rd = date.fromisoformat(rd_raw)
        except ValueError:
            return None

    meet_raw = str(row.get("meet_raw") or "").strip()
    meet = _MEET_NAMES.get(meet_raw, meet_raw if meet_raw else None)
    if not meet:
        return None

    return {
        "race_date": rd,
        "meet": meet,
        "race_no": row["race_no"],
        "horse_no": row["horse_no"],
        "ord_1c":  row.get("ord_1c"),
        "ord_2c":  row.get("ord_2c"),
        "ord_3c":  row.get("ord_3c"),
        "ord_4c":  row.get("ord_4c"),
        "ord_s1f": row.get("ord_s1f"),
        "ord_g3f": row.get("ord_g3f"),
        "ord_g1f": row.get("ord_g1f"),
        "raw":     row.get("raw"),
    }


def upsert_corners(items: list[dict[str, Any]]) -> int:
    rows = [api_item_to_corner_fields(it) for it in items]
    normalized = [r for r in (_normalize_row(r) for r in rows) if r is not None]
    if not normalized:
        return 0

    # batch 내 중복 PK 조합 dedupe.
    seen: dict[tuple, dict[str, Any]] = {}
    for r in normalized:
        key = (r["race_date"], r["meet"], r["race_no"], r["horse_no"])
        seen[key] = r
    unique = list(seen.values())

    stmt = pg_insert(RaceResultCorner).values(unique)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_race_result_corners",
        set_={
            "ord_1c":  stmt.excluded.ord_1c,
            "ord_2c":  stmt.excluded.ord_2c,
            "ord_3c":  stmt.excluded.ord_3c,
            "ord_4c":  stmt.excluded.ord_4c,
            "ord_s1f": stmt.excluded.ord_s1f,
            "ord_g3f": stmt.excluded.ord_g3f,
            "ord_g1f": stmt.excluded.ord_g1f,
            "raw":     stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("race_result_corners_upserted", count=len(unique))
    return len(unique)


def sync_date(rc_date: date, meet: int) -> int:
    with RaceResultCornerClient() as client:
        items = client.list_by_date(rc_date, meet=meet)
    log.info(
        "race_result_corners_fetched",
        date=rc_date.isoformat(), meet=meet, count=len(items),
    )
    if not items:
        return 0
    return upsert_corners(items)


def sync_date_all_meets(rc_date: date) -> int:
    """전 경마장 — 매일 결과 확정 후 cron."""
    total = 0
    for meet in (1, 2, 3):
        try:
            total += sync_date(rc_date, meet=meet)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "race_result_corners_meet_failed",
                date=rc_date.isoformat(), meet=meet, err=str(e),
            )
    return total


def backfill_recent_days(days: int = 30) -> int:
    """최근 N 일 일자별 백필 — 1차 적재용."""
    today = date.today()
    total = 0
    for i in range(days):
        d = today - timedelta(days=i)
        try:
            total += sync_date_all_meets(d)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "race_result_corners_backfill_day_failed",
                date=d.isoformat(), err=str(e),
            )
    log.info("race_result_corners_backfill_done", days=days, upserted=total)
    return total
