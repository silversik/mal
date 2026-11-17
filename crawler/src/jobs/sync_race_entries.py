"""Sync 출전표 상세정보 → `race_entries` 테이블.

앞으로 며칠 안의 예정 경주 출전 마필 리스트를 미리 가져온다.
주기: 3시간이 기본 (대시보드에서 조정 가능).

경주일은 요일로 정하지 않는다 — 공휴일(예: 2026-10-05 월 대체공휴일 17경주)에도
경주가 열린다. KRA 에 시행일정 API 가 없으므로 출전표 API 자체로 판정한다:
출전표가 공표되는 범위(오늘~+ENTRY_PUBLISH_PROBE_DAYS)는 매일 조회하고,
그 너머는 기존처럼 금/토/일만 조회한다. 어떤 날짜의 3개 경마장 조회가 모두 실패하면
그날이 경주일인지 알 수 없으므로 잡을 실패시킨다 (조용한 0건 success 방지).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_chulma import RaceChulmaClient, api_item_to_race_entry_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import Race, RaceEntry
from ..redact import redact
from ._failloud import UnitFailures, is_kra_no_data

log = get_logger(__name__)

KST = ZoneInfo("Asia/Seoul")
MEETS = (1, 2, 3)
#: 정기 경주 요일 (금/토/일) — 출전표 공표 전 구간의 조회 대상.
WEEKEND_RACE_WEEKDAYS = (4, 5, 6)
#: 출전표는 경주일 ~3일 전 공표 — 오늘~+N일은 요일 무관 매일 조회 (공휴일 경주 대응).
ENTRY_PUBLISH_PROBE_DAYS = 4


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
    grade)는 backfill_races_from_entries·sync_race_today_meta 가 채운다.

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


def _upcoming_race_dates(
    base: date,
    days_ahead: int = 10,
    probe_days: int = ENTRY_PUBLISH_PROBE_DAYS,
) -> list[date]:
    """조회할 후보 경주일 — base~base+probe_days 는 매일, 그 뒤 base+days_ahead 까지는 금/토/일."""
    if days_ahead < 0 or probe_days < 0:
        raise ValueError(f"days_ahead={days_ahead}, probe_days={probe_days} 는 0 이상이어야 함")
    out: list[date] = []
    for i in range(days_ahead + 1):
        d = base + timedelta(days=i)
        if i <= probe_days or d.weekday() in WEEKEND_RACE_WEEKDAYS:
            out.append(d)
    return out


def sync_upcoming(days_ahead: int = 10) -> int:
    """오늘(KST)로부터 days_ahead 일 이내의 예정 경주일 출전표 fetch."""
    today = datetime.now(KST).date()
    dates = _upcoming_race_dates(today, days_ahead=days_ahead)
    total = 0
    fails = UnitFailures("race_entries")
    unknown: list[date] = []  # 3개 경마장 모두 실패 → 경주일 여부 미확인
    race_days: list[date] = []
    with RaceChulmaClient() as client:
        for d in dates:
            meet_errors = 0
            day_items = 0
            for meet in MEETS:
                try:
                    items = client.list_by_date(d, meet=meet)
                except Exception as exc:  # noqa: BLE001
                    if not is_kra_no_data(exc):  # NODATA 는 정상 0건
                        meet_errors += 1
                    fails.fail(exc, "race_entries_fetch_failed", date=str(d), meet=meet)
                    continue
                fails.ok()
                log.info(
                    "race_entries_fetched",
                    date=str(d), meet=meet, count=len(items),
                )
                day_items += len(items)
                mapped = [api_item_to_race_entry_fields(it) for it in items]
                total += upsert_race_entries(mapped)
                # 출전표 수집 시점에 races 테이블에도 예정 경주 행을 즉시 만들어
                # 메인 페이지 "다음 진행 예정 경기" 섹션에 반영되도록 한다.
                upsert_races_skeleton(mapped)
            if meet_errors == len(MEETS):
                unknown.append(d)
            elif day_items:
                race_days.append(d)
    log.info(
        "race_entries_race_days",
        dates=[str(d) for d in race_days],
        weekday_race_days=[
            str(d) for d in race_days if d.weekday() not in WEEKEND_RACE_WEEKDAYS
        ],
    )
    fails.raise_if_all_failed()
    if unknown:
        raise RuntimeError(
            "race_entries: 경주일 확인 불가 — 3개 경마장 조회가 모두 실패한 날짜 "
            + ", ".join(str(d) for d in unknown)
            + f" (첫 오류: {redact(fails.first_error or '')[:200]})"
        )
    return total
