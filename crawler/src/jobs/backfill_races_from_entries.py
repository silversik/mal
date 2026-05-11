"""Backfill `races` metadata from `race_entries.raw`.

race_entries 의 KRA API26_2 응답에 `rcDist`(거리)/`rank`(등급)/`rcName`(경주명)/
`stTime`(발주시각) 가 포함되어 있는데, 현재 races 테이블에 흘러들지 않아
distance/grade/start_time/race_name 가 NULL 인 row 가 대다수 (~98%).

이 잡이 race_entries.raw 의 메타를 추출해 races 의 빈 컬럼만 채운다.
COALESCE 로 기존 non-null 값은 보존.

KRA API187 이 빈 응답을 반환하는 동안의 영구 백필 경로 (=race_entries 가
출주표 sync 잡으로 매 3시간 적재되므로 항상 fresh).
"""
from __future__ import annotations

import re

from sqlalchemy import text

from ..db import session_scope
from ..logging import get_logger

log = get_logger(__name__)

# stTime 은 "출발 :10:35" 또는 "10:35" — HH:MM 부분만 추출.
_HHMM_RE = re.compile(r"(\d{1,2}:\d{2})")


def backfill_races_metadata_from_entries() -> int:
    """race_entries.raw 의 메타 → races UPSERT.

    한 경주에 N 마필 row 가 있으니 같은 (date, meet, race_no) 메타가 동일.
    DISTINCT ON 으로 1 row 씩 뽑아 INSERT … ON CONFLICT DO UPDATE.

    Returns: 업데이트된 races 수.
    """
    sql = text(
        """
        WITH unique_races AS (
          SELECT DISTINCT ON (race_date, meet, race_no)
                 race_date, meet, race_no,
                 NULLIF(raw->>'rcDist','')::int        AS distance,
                 NULLIF(raw->>'rank','')                AS grade,
                 CASE
                   WHEN raw->>'rcName' IS NULL THEN NULL
                   WHEN raw->>'rcName' IN ('일반','') THEN NULL
                   ELSE raw->>'rcName'
                 END                                    AS race_name,
                 -- "출발 :10:35" → "10:35"; 형식이 다양해서 정규식이 안전.
                 (regexp_match(raw->>'stTime', '([0-9]{1,2}:[0-9]{2})'))[1] AS start_time,
                 NULLIF(raw->>'ageCond','')             AS age_cond
            FROM mal.race_entries
           WHERE raw IS NOT NULL
        )
        INSERT INTO mal.races (race_date, meet, race_no, distance, grade, race_name, start_time)
        SELECT race_date, meet, race_no, distance, grade, race_name, start_time
          FROM unique_races
          WHERE distance IS NOT NULL OR grade IS NOT NULL
                OR race_name IS NOT NULL OR start_time IS NOT NULL
        ON CONFLICT (race_date, meet, race_no) DO UPDATE
           SET distance   = COALESCE(mal.races.distance,   EXCLUDED.distance),
               grade      = COALESCE(mal.races.grade,      EXCLUDED.grade),
               race_name  = COALESCE(mal.races.race_name,  EXCLUDED.race_name),
               start_time = COALESCE(mal.races.start_time, EXCLUDED.start_time)
        """,
    )

    with session_scope() as s:
        result = s.execute(sql)
        count = result.rowcount or 0
    log.info("races_backfilled_from_entries", count=count)
    return count


# regex 가 SQL 안에 들어가 있어서 _HHMM_RE 가 직접 쓰이지 않지만 docstring/디버깅용 보존.
__all__ = ["backfill_races_metadata_from_entries", "_HHMM_RE"]
