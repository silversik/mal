"""KRBC 업로드 플레이리스트 전체를 walk → kra_videos UPSERT.

기존 `sync_videos_backfill` 은 search.list (100 units/call × 50개 = 5000 units/일)
로 LIMIT 50 race 씩만 처리해 1년치 누락(~2000개) 채우려면 약 40일 소요.

이 잡은 KRBC 업로드 플레이리스트를 pageToken paginate 하면서 모든 video ID 를
가져와 한 번에 fetch_videos + upsert. 비용:
  - playlistItems pages: ~1 unit × 페이지수(50개/페이지). 1년 ~2000 영상 = 40 unit
  - videos.list batch: 1 unit / 50개 = 40 unit
  - 합계 ~80 units 로 1년치 cover (search 대비 ~60x 절감)

manual / monthly trigger 용. cron 등록은 sync_videos_backfill 그대로 유지하고
이건 1회성 갭 메우기용.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from ..clients.youtube import YoutubeClient
from ..config import settings
from ..logging import get_logger
from .sync_videos import upsert_videos

log = get_logger(__name__)


def bulk_backfill_videos(*, months_back: int = 12, hard_limit: int = 5000) -> int:
    """KRBC 업로드 플레이리스트 walk → 매칭되는 race_date 영상 모두 UPSERT.

    Args:
        months_back: 이 개월 이전 영상은 제외 (publishedAt 기준 early-exit). 기본 12.
        hard_limit: 폭주 방지 (영상 ID 수 상한). 기본 5000.

    Returns: upsert 된 영상 수.
    """
    if not settings.youtube_api_key or not settings.youtube_krbc_channel_id:
        raise RuntimeError(
            "YOUTUBE_API_KEY / YOUTUBE_KRBC_CHANNEL_ID 미설정"
        )

    cutoff = datetime.now(tz=UTC) - timedelta(days=30 * months_back)
    log.info("videos_bulk_start", cutoff=cutoff.isoformat(), hard_limit=hard_limit)

    with YoutubeClient(settings.youtube_api_key) as client:
        playlist_id = client.resolve_uploads_playlist(
            settings.youtube_krbc_channel_id,
        )
        items = client.list_all_video_items(
            playlist_id, published_after=cutoff, hard_limit=hard_limit,
        )
        if not items:
            log.info("videos_bulk_no_items")
            return 0
        ids = [it["video_id"] for it in items]
        log.info("videos_bulk_fetched_ids", count=len(ids))
        videos = client.fetch_videos(ids)

    upserted = upsert_videos(videos)
    log.info("videos_bulk_done", upserted=upserted, ids=len(ids))
    return upserted
