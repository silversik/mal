"""Sync KRBC YouTube uploads → `kra_videos` (UPSERT, uploads playlist 캐싱)."""
from __future__ import annotations

import re
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.youtube import YoutubeClient, YoutubeVideo
from ..config import settings
from ..db import session_scope
from ..logging import get_logger
from ..models import KraVideo, SyncMeta

log = get_logger(__name__)
SOURCE = "youtube_krbc"

# KRBC 제목 포맷: "(서울) 2026.02.28 1경주" — 구분자는 `.` 또는 `-` 허용.
_TITLE_RACE_RE = re.compile(
    r"\(\s*(?P<meet>[^)]+?)\s*\)\s*"
    r"(?P<y>\d{4})[.\-](?P<m>\d{1,2})[.\-](?P<d>\d{1,2})\s*"
    r"(?P<no>\d+)\s*경주"
)


def parse_race_from_title(title: str) -> tuple[date | None, str | None, int | None]:
    """제목에서 (race_date, meet, race_no) 추출. 매칭 실패 시 모두 None."""
    m = _TITLE_RACE_RE.search(title)
    if not m:
        return None, None, None
    try:
        d = date(int(m["y"]), int(m["m"]), int(m["d"]))
    except ValueError:
        return None, None, None
    return d, m["meet"].strip(), int(m["no"])


def _to_row(v: YoutubeVideo) -> dict[str, Any]:
    race_date, meet, race_no = parse_race_from_title(v.title)
    return {
        "video_id": v.video_id,
        "channel_id": v.channel_id,
        "channel_title": v.channel_title,
        "title": v.title,
        "description": v.description,
        "thumbnail_url": v.thumbnail_url,
        "duration_sec": v.duration_sec,
        "view_count": v.view_count,
        "published_at": v.published_at,
        "race_date": race_date,
        "meet": meet,
        "race_no": race_no,
        "raw": v.raw,
    }


def upsert_videos(videos: list[YoutubeVideo]) -> int:
    rows = [_to_row(v) for v in videos]
    if not rows:
        return 0

    stmt = pg_insert(KraVideo).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[KraVideo.video_id],
        set_={
            "channel_id": stmt.excluded.channel_id,
            "channel_title": stmt.excluded.channel_title,
            "title": stmt.excluded.title,
            "description": stmt.excluded.description,
            "thumbnail_url": stmt.excluded.thumbnail_url,
            "duration_sec": stmt.excluded.duration_sec,
            "view_count": stmt.excluded.view_count,
            "published_at": stmt.excluded.published_at,
            "race_date": stmt.excluded.race_date,
            "meet": stmt.excluded.meet,
            "race_no": stmt.excluded.race_no,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("kra_videos_upserted", count=len(rows))
    return len(rows)


def sync_videos(*, max_results: int = 20) -> int:
    """Fetch latest KRBC uploads → UPSERT. uploads playlist ID는 sync_meta에 캐싱."""
    if not settings.youtube_krbc_channel_id:
        raise RuntimeError("YOUTUBE_KRBC_CHANNEL_ID is not set")

    with session_scope() as s:
        meta = s.get(SyncMeta, SOURCE)
        cached_playlist = meta.page_token if meta else None

    error: str | None = None
    count = 0
    playlist_id = cached_playlist

    try:
        with YoutubeClient(settings.youtube_api_key) as client:
            videos, playlist_id = client.list_recent(
                settings.youtube_krbc_channel_id,
                max_results=max_results,
                uploads_playlist_id=cached_playlist,
            )
        count = upsert_videos(videos)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        log.error("kra_videos_sync_failed", error=error)
        raise
    finally:
        _record_meta(playlist_id=playlist_id, success=error is None, error=error)

    return count


def _record_meta(*, playlist_id: str | None, success: bool, error: str | None) -> None:
    now = datetime.now(tz=UTC)
    values = {
        "source": SOURCE,
        "last_run_at": now,
        "last_success_at": now if success else None,
        "page_token": playlist_id,  # uploads playlist ID 캐시 (호출 1회 절약)
        "last_error": error,
    }
    stmt = pg_insert(SyncMeta).values(values)
    set_ = {
        "last_run_at": stmt.excluded.last_run_at,
        "page_token": stmt.excluded.page_token,
        "last_error": stmt.excluded.last_error,
        "updated_at": func.now(),
    }
    if success:
        set_["last_success_at"] = stmt.excluded.last_success_at
    stmt = stmt.on_conflict_do_update(index_elements=[SyncMeta.source], set_=set_)
    with session_scope() as s:
        s.execute(stmt)


def smoke_videos(*, n: int = 5) -> list[YoutubeVideo]:
    """Fetch top N videos without writing. For `mal smoke-videos`."""
    if not settings.youtube_krbc_channel_id:
        raise RuntimeError("YOUTUBE_KRBC_CHANNEL_ID is not set")
    with YoutubeClient(settings.youtube_api_key) as client:
        videos, _ = client.list_recent(settings.youtube_krbc_channel_id, max_results=n)
    return videos
