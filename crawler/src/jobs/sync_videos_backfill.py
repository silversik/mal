"""Backfill `kra_videos` for races without a linked video via YouTube search.

기본 `sync_videos` (업로드 플레이리스트 크롤) 는 최근 20건만 긁고 제목이 포맷에
안 맞으면 매칭 실패. 이 job 은 `races` 와 `kra_videos` 를 LEFT JOIN 해서
매칭 안 된 최근 경주를 찾아, YouTube Data API v3 search 로 제목 패턴
`"(위치) YYYY.MM.DD N경주"` 로 다시 찾아 upsert.

할당량: search = 100 units/call. LIMIT 50 → 하루 최대 5,000 units (기본 10,000).
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text

from ..clients.youtube import YoutubeClient, YoutubeVideo
from ..config import settings
from ..db import session_scope
from ..logging import get_logger
from .sync_videos import upsert_videos

log = get_logger(__name__)


# KRBC 제목 포맷 — 크롤러와 웹의 수동 검색 URL 이 동일 포맷을 쓰도록 유지.
def format_race_title_query(race_date: date, meet: str, race_no: int) -> str:
    return f"({meet}) {race_date.strftime('%Y.%m.%d')} {race_no}경주"


def _find_missing(days_back: int, limit: int) -> list[dict[str, Any]]:
    """kra_videos 에 매칭 없는 최근 경주 (date, meet, race_no) 목록."""
    sql = text(
        """
        SELECT race_date, meet, race_no
          FROM races r
         WHERE r.race_date >= CURRENT_DATE - (:days * INTERVAL '1 day')
           AND r.race_date <= CURRENT_DATE
           AND NOT EXISTS (
             SELECT 1 FROM kra_videos v
              WHERE v.race_date = r.race_date
                AND v.meet = r.meet
                AND v.race_no = r.race_no
           )
         ORDER BY r.race_date DESC, r.meet, r.race_no
         LIMIT :limit
        """
    )
    with session_scope() as s:
        rows = s.execute(sql, {"days": days_back, "limit": limit}).mappings().all()
    return [dict(r) for r in rows]


def backfill_missing_race_videos(
    *, days_back: int = 30, limit: int = 50
) -> int:
    """매칭 안 된 최근 `days_back` 일 경주를 YouTube search 로 찾아 upsert.

    Returns: upsert 된 영상 수 (정확히 매칭된 경주 수와 같지 않을 수 있음 —
    search 가 제목만 반환 후 fetch_videos 로 상세 조회 시 race_date 파싱 실패로
    race_date/meet/race_no 는 NULL 로 들어갈 수 있다. 여기서는 가장 관련도 높은
    1건만 받아와 upsert — 이후 관리자 수정 가능).
    """
    missing = _find_missing(days_back, limit)
    if not missing:
        log.info("videos_backfill_nothing_missing")
        return 0

    log.info(
        "videos_backfill_start",
        missing=len(missing),
        days_back=days_back,
        limit=limit,
    )

    total = 0
    failed = 0
    with YoutubeClient(settings.youtube_api_key) as client:
        for row in missing:
            rd: date = row["race_date"]
            meet: str = row["meet"]
            race_no: int = row["race_no"]
            query = format_race_title_query(rd, meet, race_no)
            try:
                videos: list[YoutubeVideo] = client.search_videos(
                    query,
                    channel_id=settings.youtube_krbc_channel_id,
                    max_results=1,
                )
            except Exception as exc:
                failed += 1
                log.warning(
                    "videos_backfill_search_failed",
                    query=query,
                    err=str(exc),
                )
                continue
            if not videos:
                log.info("videos_backfill_no_match", query=query)
                continue
            total += upsert_videos(videos)

    log.info("videos_backfill_done", upserted=total, failed=failed)
    return total
