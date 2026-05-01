"""즐겨찾기 마필의 다음 경기 출주 → 인앱 알림(notifications) 적재.

`user_favorite_horses` × `race_entries` (race_date >= 오늘 KST) 매칭하여
사용자별로 1건씩 알림 INSERT. dedup_key 로 중복 방지.

cron 으로 자주 돌려도 새 entries 가 생긴 만큼만 INSERT 되므로 idempotent.
"""
from __future__ import annotations

from sqlalchemy import text

from ..db import session_scope
from ..logging import get_logger

log = get_logger(__name__)


_INSERT_SQL = text(
    """
    INSERT INTO notifications (user_id, kind, dedup_key, title, body, href)
    SELECT
        s.user_id,
        'horse_upcoming_race' AS kind,
        s.horse_no || '|' || s.race_date::text || '|' || s.meet || '|' || s.race_no::text AS dedup_key,
        '즐겨찾기 마필 출주 — ' || COALESCE(h.horse_name, s.horse_no) AS title,
        s.race_date::text || ' · ' || s.meet || ' · ' || s.race_no || 'R' AS body,
        '/races?date=' || s.race_date::text
            || '&venue=' || replace(replace(replace(s.meet, '%', '%25'), '&', '%26'), '+', '%2B')
            || '&race=' || s.race_no::text AS href
    FROM (
        SELECT DISTINCT
            f.user_id,
            e.horse_no,
            e.race_date,
            e.meet,
            e.race_no
        FROM user_favorite_horses f
        JOIN race_entries e USING (horse_no)
        WHERE e.race_date >= (NOW() AT TIME ZONE 'Asia/Seoul')::date
    ) s
    LEFT JOIN horses h ON h.horse_no = s.horse_no
    ON CONFLICT (user_id, kind, dedup_key) DO NOTHING
    RETURNING 1
    """
)


def build_favorite_notifications() -> int:
    """매칭되는 (user, race) 조합에 대해 알림 INSERT. 새로 생성된 row 수 반환."""
    with session_scope() as s:
        result = s.execute(_INSERT_SQL)
        rows = result.fetchall()
    inserted = len(rows)
    log.info("favorite_notifications_built", inserted=inserted)
    return inserted
