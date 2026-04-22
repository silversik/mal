"""Sync race-level metadata into `races` table.

Two complementary strategies:

1. `backfill_races_from_results()` — race_results 에 있는 튜플 중 races 에 없는
   것만 새로 만든다. entry_count 는 결과 rows 의 COUNT 로 근사한다. (SQL only)
2. `backfill_races_metadata()` — KRA API187 (HorseRaceInfo) 로 경주 레벨 메타
   (race_name / distance / grade / track_* / start_time) 를 받아 빈 컬럼만
   채운다. COALESCE 로 기존 non-null 값은 보존.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_info import RaceInfoClient, api_item_to_race_fields
from ..db import session_scope
from ..logging import get_logger
from ..models import Race

log = get_logger(__name__)


def backfill_races_from_results() -> int:
    """Insert into `races` any (race_date, meet, race_no) tuples present in
    race_results but missing from races. Sets entry_count from the count of
    result rows per race."""

    sql = text("""
        INSERT INTO races (race_date, meet, race_no, entry_count)
        SELECT r.race_date, r.meet, r.race_no, COUNT(*) AS entry_count
          FROM race_results r
         WHERE NOT EXISTS (
               SELECT 1 FROM races ra
                WHERE ra.race_date = r.race_date
                  AND ra.meet = r.meet
                  AND ra.race_no = r.race_no
               )
         GROUP BY r.race_date, r.meet, r.race_no
        ON CONFLICT (race_date, meet, race_no) DO NOTHING
    """)

    with session_scope() as s:
        result = s.execute(sql)
        count = result.rowcount or 0

    log.info("races_backfilled", count=count)
    return count


# Keep this alias so the CLI command still works.
def sync_races_by_year(year: int, meet: int | None = None) -> int:
    """Backfill races from race_results (year/meet params ignored for now)."""
    return backfill_races_from_results()


# --------------------------------------------------------------------- API187


def _row_for_upsert(fields: dict[str, Any]) -> dict[str, Any] | None:
    """api_item_to_race_fields 반환값을 races INSERT용 row 로 정규화.

    필수 키(race_date/meet/race_no) 없으면 None. race_date 는 date 객체로 변환.
    """
    rd_raw = fields.get("race_date")
    meet = fields.get("meet")
    race_no = fields.get("race_no")
    if not (rd_raw and meet and race_no is not None):
        return None
    if isinstance(rd_raw, date):
        rd = rd_raw
    else:
        try:
            rd = datetime.strptime(str(rd_raw), "%Y-%m-%d").date()
        except ValueError:
            return None

    return {
        "race_date": rd,
        "meet": meet,
        "race_no": race_no,
        "race_name": fields.get("race_name"),
        "distance": fields.get("distance"),
        "grade": fields.get("grade"),
        "track_type": fields.get("track_type"),
        "track_condition": fields.get("track_condition"),
        "entry_count": fields.get("entry_count"),
        "start_time": fields.get("start_time"),
        "raw": fields.get("raw"),
    }


def backfill_races_metadata(year: int | None = None) -> int:
    """API187 로 year 의 경주 메타를 받아 `races` 의 빈 컬럼만 채운다.

    이미 값이 있는 행은 COALESCE 로 보존 — 결과에서 들어온 정확한 entry_count
    같은 값을 API187 근사치가 덮어쓰지 않도록 한다.
    """
    yr = year or date.today().year
    total = 0
    with RaceInfoClient() as client:
        for meet in (1, 2, 3):
            try:
                items = client.list_by_year(yr, meet=meet)
            except Exception as exc:
                log.warning(
                    "race_info_fetch_failed", year=yr, meet=meet, err=str(exc),
                )
                continue

            rows = []
            seen: set[tuple] = set()
            for it in items:
                fields = api_item_to_race_fields(it)
                row = _row_for_upsert(fields)
                if row is None:
                    continue
                key = (row["race_date"], row["meet"], row["race_no"])
                if key in seen:
                    continue
                seen.add(key)
                rows.append(row)
            if not rows:
                continue

            stmt = pg_insert(Race).values(rows)
            ex = stmt.excluded
            stmt = stmt.on_conflict_do_update(
                constraint="uq_races",
                set_={
                    "race_name":       func.coalesce(Race.race_name,       ex.race_name),
                    "distance":        func.coalesce(Race.distance,        ex.distance),
                    "grade":           func.coalesce(Race.grade,           ex.grade),
                    "track_type":      func.coalesce(Race.track_type,      ex.track_type),
                    "track_condition": func.coalesce(Race.track_condition, ex.track_condition),
                    "entry_count":     func.coalesce(Race.entry_count,     ex.entry_count),
                    "start_time":      func.coalesce(Race.start_time,      ex.start_time),
                },
            )
            with session_scope() as s:
                s.execute(stmt)
            log.info(
                "races_metadata_backfilled", year=yr, meet=meet, count=len(rows),
            )
            total += len(rows)
    return total
