"""당일 경주 메타(발주시각·거리) HTML 크롤링 sync.

KRA OpenAPI API187 (HorseRaceInfo) 가 현재 빈 응답을 반환하는 상황의 fallback.
race.kra.co.kr/seoulMain.do 를 파싱해 races 테이블의 distance/start_time 컬럼을
채운다. 기존 값 보존(COALESCE) — race_results / sync_race_info 가 이미 채운
값을 덮어쓰지 않도록.

주의: 이 페이지는 "오늘" 의 경주만 보여주므로, 어제·내일 데이터까진 다루지 않는다.
홈 카로셀 표시용으로 충분.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_today_html import fetch_today_races
from ..db import session_scope
from ..logging import get_logger
from ..models import Race

log = get_logger(__name__)


def _row_for_upsert(item: dict[str, Any]) -> dict[str, Any] | None:
    rd_raw = item.get("race_date")
    meet = item.get("meet")
    race_no = item.get("race_no")
    if not (rd_raw and meet and race_no is not None):
        return None
    try:
        rd = datetime.strptime(str(rd_raw), "%Y-%m-%d").date()
    except ValueError:
        return None
    return {
        "race_date": rd,
        "meet": meet,
        "race_no": race_no,
        "start_time": item.get("start_time"),
        "distance": item.get("distance"),
        "race_name": item.get("race_name"),
    }


def sync_today_meta() -> int:
    """seoulMain.do 크롤링 → races UPSERT. 새로 채운 row 수 반환."""
    items = fetch_today_races()
    if not items:
        log.info("today_meta_no_items")
        return 0
    rows: list[dict[str, Any]] = []
    seen: set[tuple[date, str, int]] = set()
    for it in items:
        row = _row_for_upsert(it)
        if row is None:
            continue
        key = (row["race_date"], row["meet"], row["race_no"])
        if key in seen:
            continue
        seen.add(key)
        rows.append(row)
    if not rows:
        return 0
    stmt = pg_insert(Race).values(rows)
    ex = stmt.excluded
    # 기존 non-null 값은 보존 — race_results 기반 정확값을 HTML 크롤링이 덮어쓰지 않음.
    stmt = stmt.on_conflict_do_update(
        constraint="uq_races",
        set_={
            "start_time": func.coalesce(Race.start_time, ex.start_time),
            "distance":   func.coalesce(Race.distance,   ex.distance),
            "race_name":  func.coalesce(Race.race_name,  ex.race_name),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("today_meta_synced", count=len(rows))
    return len(rows)
