"""races 테이블 보강 — race_results 에 있는데 races 에 없는 경주 행을 만든다.

(KRA API187 HorseRaceInfo 메타 백필은 2026-05 이후 빈 응답만 와서 2026-11 제거.
 발주시각·거리 등은 sync_race_today_meta(HTML)·backfill_races_from_entries 가 채운다.)
"""
from __future__ import annotations

from zoneinfo import ZoneInfo

from sqlalchemy import text

from ..db import session_scope
from ..logging import get_logger

log = get_logger(__name__)

KST = ZoneInfo("Asia/Seoul")


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
