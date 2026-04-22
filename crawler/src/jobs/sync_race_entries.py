"""Sync 출전표 상세정보 → `race_entries` 테이블.

이번 주 주말(금/토/일) 예정 경주의 출전 마필 리스트를 미리 가져온다.
주기: 3시간이 기본 (대시보드에서 조정 가능).
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_chulma import RaceChulmaClient, api_item_to_race_entry_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import Race, RaceEntry

log = get_logger(__name__)


def upsert_race_entries(items: list[dict[str, Any]]) -> int:
    rows = [
        r for r in items
        if r.get("race_date") and r.get("race_no") is not None and r.get("horse_no")
    ]
    if not rows:
        return 0

    # Dedup in-batch to avoid CardinalityViolation.
    seen: set[tuple] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        key = (str(r["race_date"]), r["meet"], r["race_no"], r["horse_no"])
        if key not in seen:
            seen.add(key)
            unique.append(r)

    stmt = pg_insert(RaceEntry).values(unique)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_race_entries",
        set_={
            "chul_no": stmt.excluded.chul_no,
            "horse_name": stmt.excluded.horse_name,
            "jk_no": stmt.excluded.jk_no,
            "jockey_name": stmt.excluded.jockey_name,
            "trainer_name": stmt.excluded.trainer_name,
            "weight": stmt.excluded.weight,
            "age": stmt.excluded.age,
            "sex": stmt.excluded.sex,
            "rating": stmt.excluded.rating,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("race_entries_upserted", count=len(unique))
    return len(unique)


def upsert_races_skeleton(items: list[dict[str, Any]]) -> int:
    """출전표 items 로부터 (race_date, meet, race_no) 고유 키를 뽑아 `races` 에
    선(先) 행을 만든다. entry_count 만 채우고 나머지 메타(race_name/distance/
    grade/track_*)는 sync_race_info 의 API187 백필이 담당한다.

    기존 races 행이 이미 있으면 entry_count 만 COALESCE 로 채운다 — 결과가
    이미 들어온 레이스의 정확한 entry_count 를 덮어쓰지 않도록.
    """
    counts: dict[tuple[date, str, int], int] = {}
    for r in items:
        rd = r.get("race_date")
        mt = r.get("meet")
        rn = r.get("race_no")
        if not (rd and mt and rn is not None):
            continue
        counts[(rd, mt, rn)] = counts.get((rd, mt, rn), 0) + 1

    if not counts:
        return 0

    rows = [
        {"race_date": rd, "meet": mt, "race_no": rn, "entry_count": n}
        for (rd, mt, rn), n in counts.items()
    ]
    stmt = pg_insert(Race).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_races",
        set_={
            # 기존 값 보존 — race_results 기반 정확 카운트를 덮어쓰지 않음.
            "entry_count": func.coalesce(Race.entry_count, stmt.excluded.entry_count),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("races_skeleton_upserted", count=len(rows))
    return len(rows)


def _upcoming_race_dates(base: date, days_ahead: int = 10) -> list[date]:
    """base~base+days 내의 금/토/일 일자만 반환 — KRA 경주 요일."""
    out: list[date] = []
    for i in range(days_ahead + 1):
        d = base + timedelta(days=i)
        if d.weekday() in (4, 5, 6):  # Fri, Sat, Sun
            out.append(d)
    return out


def sync_upcoming(days_ahead: int = 10) -> int:
    """오늘로부터 며칠 이내의 예정 경주일 모두 fetch."""
    today = date.today()
    dates = _upcoming_race_dates(today, days_ahead=days_ahead)
    total = 0
    with RaceChulmaClient() as client:
        for d in dates:
            for meet in (1, 2, 3):
                try:
                    items = client.list_by_date(d, meet=meet)
                except Exception as exc:
                    log.warning(
                        "race_entries_fetch_failed",
                        date=str(d), meet=meet, err=str(exc),
                    )
                    continue
                log.info(
                    "race_entries_fetched",
                    date=str(d), meet=meet, count=len(items),
                )
                mapped = [api_item_to_race_entry_fields(it) for it in items]
                total += upsert_race_entries(mapped)
                # 출전표 수집 시점에 races 테이블에도 예정 경주 행을 즉시 만들어
                # 메인 페이지 "다음 진행 예정 경기" 섹션에 반영되도록 한다.
                upsert_races_skeleton(mapped)
    return total
