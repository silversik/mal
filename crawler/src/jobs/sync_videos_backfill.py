"""Backfill `kra_videos` for races without a linked video via YouTube search.

기본 `sync_videos` (업로드 플레이리스트 크롤) 는 최근 20건만 긁고 제목이 포맷에
안 맞으면 매칭 실패. 이 job 은 `races` 와 `kra_videos` 를 LEFT JOIN 해서
매칭 안 된 최근 경주를 찾아, YouTube Data API v3 search 로 제목 패턴
`"(위치) YYYY.MM.DD N경주"` 로 다시 찾아 upsert.

할당량: search = 100 units/call. 기본 LIMIT 20 → 하루 최대 2,000 units (한도 10,000).
최근 창(기본 35일)만 맡고, 그보다 오래된 누락은 월 1회 `sync_videos_bulk`
(업로드 플레이리스트 12개월 walk, ~80 units) 가 cover 한다.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text

from ..clients.youtube import YoutubeClient, YoutubeVideo
from ..config import settings
from ..db import session_scope
from ..logging import get_logger
from ._failloud import UnitFailures
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
    *, days_back: int = 35, limit: int = 20
) -> int:
    """매칭 안 된 최근 `days_back` 일 경주를 YouTube search 로 찾아 upsert.

    sync_videos 가 uploads playlist head 만 max_results=20 으로 가져오는
    구조라 race day 영상 폭주(~30개) 시 일부가 head 에서 밀려 적재 누락되는
    케이스가 있고, 그 backstop 이 backfill 의 search. 예전엔 365일 · LIMIT 50
    (5,000 units/day) 으로 오래된 누락(영광의월드 0047231 1년 공백 사례)까지
    search 로 메웠지만, 지금은 월 1회 sync_videos_bulk 가 12개월 업로드
    플레이리스트를 ~80 units 로 walk 해 같은 누락을 cover 한다. 그래서 search 는
    bulk 주기(최대 31일)보다 약간 넓은 35일 · LIMIT 20 (≤2,000 units/day) 으로 축소.
    ORDER DESC 라 최신 경주부터 매일 회전 처리.

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
    fails = UnitFailures("videos_backfill")
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
            except Exception as exc:  # noqa: BLE001
                fails.fail(exc, "videos_backfill_search_failed", query=query)
                continue
            fails.ok()
            if not videos:
                log.info("videos_backfill_no_match", query=query)
                continue
            total += upsert_videos(videos)

    log.info("videos_backfill_done", upserted=total, failed=fails.failed)
    fails.raise_if_all_failed()
    return total
