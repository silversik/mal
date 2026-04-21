"""Sync race-level metadata into `races` table.

Since API187 (HorseRaceInfo) provides monthly aggregate counts rather than
per-race detail, we derive individual race records from `race_results`.
"""
from __future__ import annotations

from sqlalchemy import text

from ..db import session_scope
from ..logging import get_logger

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
