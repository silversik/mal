"""Sync 대상경주 연간계획 → `race_plans` 테이블."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.kra_base import KraApiError
from ..clients.race_annual_plan import RaceAnnualPlanClient, api_item_to_race_plan_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import RacePlan

log = get_logger(__name__)

KST = ZoneInfo("Asia/Seoul")

# KRA 는 다음 해 대상경주 계획을 12월 전후로 공개 — 11~12월엔 내년도 함께 조회.
NEXT_YEAR_MONTHS = frozenset({11, 12})

# data.go.kr resultCode "03" = NODATA_ERROR (아직 미공개).
_NO_DATA_CODES = frozenset({"03"})


def kst_today() -> date:
    # 컨테이너 TZ 에 의존하지 않고 KST 기준 날짜를 명시
    return datetime.now(KST).date()


def target_years(today: date) -> list[int]:
    """동기화 대상 연도. 11~12월은 [올해, 내년], 그 외엔 [올해]."""
    if today.month in NEXT_YEAR_MONTHS:
        return [today.year, today.year + 1]
    return [today.year]


def _is_no_data(exc: KraApiError) -> bool:
    return exc.code in _NO_DATA_CODES or "NODATA" in str(exc).upper()


def upsert_race_plans(items: list[dict[str, Any]]) -> int:
    rows = [r for r in items if r.get("race_name") and r.get("meet") and r.get("year")]
    if not rows:
        return 0

    # Dedup by unique key (meet, year, race_name) — 응답에 동일 race_name 이 회차별로
    # 여러 번 나올 수 있어 batch UPSERT 가 CardinalityViolation 을 터뜨린다.
    seen: set[tuple] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        key = (r["meet"], r["year"], r["race_name"])
        if key not in seen:
            seen.add(key)
            unique.append(r)
    rows = unique

    stmt = pg_insert(RacePlan).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_race_plans",
        set_={
            "race_date": stmt.excluded.race_date,
            "race_no": stmt.excluded.race_no,
            "grade": stmt.excluded.grade,
            "distance": stmt.excluded.distance,
            "track_type": stmt.excluded.track_type,
            "age_cond": stmt.excluded.age_cond,
            "prize_1st": stmt.excluded.prize_1st,
            "total_prize": stmt.excluded.total_prize,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("race_plans_upserted", count=len(rows))
    return len(rows)


def sync_year(year: int, *, meet: int | None = None, allow_no_data: bool = False) -> int:
    """Fetch year plan for given meet (None = all 3).

    allow_no_data=True 면 KRA NODATA 응답을 0건으로 취급 (내년도 미공개 대비).
    그 외 에러(키·한도·네트워크)는 그대로 raise.
    """
    meets = [meet] if meet is not None else [1, 2, 3]
    total = 0
    with RaceAnnualPlanClient() as client:
        for m in meets:
            try:
                items = client.list_by_year(year, meet=m)
            except KraApiError as exc:
                if not (allow_no_data and _is_no_data(exc)):
                    raise
                log.info("race_plan_not_published", year=year, meet=m, error=str(exc))
                continue
            log.info("race_plan_fetched", year=year, meet=m, count=len(items))
            mapped = [api_item_to_race_plan_fields(it, year=year) for it in items]
            total += upsert_race_plans(mapped)
    return total


def sync_scheduled_years(today: date | None = None) -> int:
    """스케줄 진입점 — 올해 + (11~12월이면) 내년도.

    올해 조회 실패는 그대로 실패. 내년도는 0건/NODATA 가 정상(KRA 미공개)이라 통과.
    """
    today = today or kst_today()
    current, *upcoming = target_years(today)
    total = sync_year(current)
    for y in upcoming:
        n = sync_year(y, allow_no_data=True)
        log.info("race_plan_next_year", year=y, count=n)
        total += n
    return total
