"""Sync race-level corner/section records from KRA API6_1/raceDetailSectionRecord_1.

데이터 구조: 한 경주 = 한 row (마필 단위 아님). 펄롱별 구간기록·통과시간·통과거리
+ 1등마의 통과 순위 (S1F→1C/2C/3C/4C→G2F/G1F).

mal.kr 의 페이스 맵 (B-1) 의존. KRA publicDataPk=15057847 활용신청 필요.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_result_corner import (
    RaceResultCornerClient,
    api_item_to_corner_fields,
)
from ..db import session_scope
from ..logging import get_logger
from ..models import RaceCorner

log = get_logger(__name__)


def _normalize_row(row: dict[str, Any]) -> dict[str, Any] | None:
    if row.get("_skip"):
        return None
    rd_raw = str(row["race_date_raw"])
    if len(rd_raw) == 8 and rd_raw.isdigit():
        try:
            rd = date(int(rd_raw[:4]), int(rd_raw[4:6]), int(rd_raw[6:8]))
        except ValueError:
            return None
    else:
        try:
            rd = datetime.fromisoformat(rd_raw).date()
        except ValueError:
            return None

    # _skip / race_date_raw 는 모델에 없는 키 — 제거.
    out = {k: v for k, v in row.items() if k not in {"_skip", "race_date_raw"}}
    out["race_date"] = rd
    return out


def upsert_corners(items: list[dict[str, Any]]) -> int:
    mapped = [api_item_to_corner_fields(it) for it in items]
    normalized = [r for r in (_normalize_row(m) for m in mapped) if r is not None]
    if not normalized:
        return 0

    # batch 내 동일 (date, meet, race_no) 중복 dedupe — KRA 가 같은 race 가 페이지에
    # 중복돼 응답할 가능성 (sales/dividends 잡과 동일 패턴 적용).
    seen: dict[tuple, dict[str, Any]] = {}
    for r in normalized:
        key = (r["race_date"], r["meet"], r["race_no"])
        seen[key] = r
    unique = list(seen.values())

    stmt = pg_insert(RaceCorner).values(unique)

    # 갱신 대상 컬럼 — passrank_* + time_*f + dist_*f + passtime_*f + raw.
    update_set: dict[str, Any] = {"raw": stmt.excluded.raw, "updated_at": func.now()}
    for col in [
        "rc_dist",
        "passrank_s1f", "passrank_g8f_1c", "passrank_g6f_2c", "passrank_g4f_3c",
        "passrank_g3f_4c", "passrank_g2f", "passrank_g1f",
    ]:
        update_set[col] = getattr(stmt.excluded, col)
    for n in range(1, 13):
        update_set[f"time_{n}f"] = getattr(stmt.excluded, f"time_{n}f")
    for n in range(1, 11):
        update_set[f"dist_{n}f"] = getattr(stmt.excluded, f"dist_{n}f")
        update_set[f"passtime_{n}f"] = getattr(stmt.excluded, f"passtime_{n}f")

    stmt = stmt.on_conflict_do_update(constraint="uq_race_corners", set_=update_set)

    with session_scope() as s:
        s.execute(stmt)

    log.info("race_corners_upserted", count=len(unique))
    return len(unique)


def sync_date(rc_date: date, meet: int) -> int:
    with RaceResultCornerClient() as client:
        items = client.list_by_date(rc_date, meet=meet)
    log.info(
        "race_corners_fetched",
        date=rc_date.isoformat(), meet=meet, count=len(items),
    )
    if not items:
        return 0
    return upsert_corners(items)


def sync_date_all_meets(rc_date: date) -> int:
    total = 0
    for meet in (1, 2, 3):
        try:
            total += sync_date(rc_date, meet=meet)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "race_corners_meet_failed",
                date=rc_date.isoformat(), meet=meet, err=str(e),
            )
    return total


def backfill_recent_days(days: int = 30) -> int:
    today = date.today()
    total = 0
    for i in range(days):
        d = today - timedelta(days=i)
        try:
            total += sync_date_all_meets(d)
        except Exception as e:  # noqa: BLE001
            log.warning(
                "race_corners_backfill_day_failed",
                date=d.isoformat(), err=str(e),
            )
    log.info("race_corners_backfill_done", days=days, upserted=total)
    return total
