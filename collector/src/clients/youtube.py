"""YouTube Data API v3 클라이언트 — KRBC 한국마사회 경마방송 채널 동기화용.

호출 패턴 (할당량 절약)
1. (선택) channels.list(part=contentDetails) → uploads playlist ID  [1 unit]
2. playlistItems.list(part=contentDetails)  → 최근 videoIds         [1 unit]
3. videos.list(part=snippet,contentDetails,statistics, id=ids)
                                            → 메타/통계 batch       [1 unit / 50개]

1시간 주기 sync면 일 약 48 units → 기본 quota(10,000/일) 대비 매우 안전.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..logging import get_logger

log = get_logger(__name__)

YT_BASE = "https://www.googleapis.com/youtube/v3"
DESCRIPTION_MAX_LEN = 200
_ISO_DURATION_RE = re.compile(
    r"^PT(?:(?P<h>\d+)H)?(?:(?P<m>\d+)M)?(?:(?P<s>\d+)S)?$"
)


@dataclass(frozen=True)
class YoutubeVideo:
    video_id: str
    channel_id: str
    channel_title: str | None
    title: str
    description: str | None
    thumbnail_url: str
    duration_sec: int | None
    view_count: int | None
    published_at: datetime
    raw: dict[str, Any] = field(default_factory=dict)


class YoutubeApiError(RuntimeError):
    """YouTube API non-retryable error (e.g. quotaExceeded, keyInvalid)."""


class YoutubeClient:
    def __init__(self, api_key: str, timeout: float = 15.0) -> None:
        if not api_key:
            raise ValueError("YOUTUBE_API_KEY is empty")
        self.api_key = api_key
        self._client = httpx.Client(
            base_url=YT_BASE,
            timeout=httpx.Timeout(timeout, connect=5.0),
            headers={"Accept": "application/json"},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> YoutubeClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # --------------------------------------------------------------- raw GET

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type(httpx.TransportError),
        before_sleep=before_sleep_log(log, 30),
    )
    def _get(self, path: str, **params: Any) -> dict[str, Any]:
        params["key"] = self.api_key
        resp = self._client.get(f"/{path.lstrip('/')}", params=params)
        if resp.status_code >= 400:
            self._raise_for_api_error(resp)
        return resp.json()

    @staticmethod
    def _raise_for_api_error(resp: httpx.Response) -> None:
        try:
            err = resp.json().get("error", {})
        except Exception:
            err = {}
        msg = err.get("message") or resp.text[:200]
        # quotaExceeded / keyInvalid 등은 재시도해도 의미 없음 → 즉시 raise
        raise YoutubeApiError(f"YouTube API {resp.status_code}: {msg}")

    # ------------------------------------------------------------- public API

    def resolve_uploads_playlist(self, channel_id: str) -> str:
        """채널 ID → 업로드 플레이리스트 ID."""
        data = self._get("channels", part="contentDetails", id=channel_id)
        items = data.get("items") or []
        if not items:
            raise YoutubeApiError(f"channel not found: {channel_id}")
        return items[0]["contentDetails"]["relatedPlaylists"]["uploads"]

    def list_recent_video_ids(
        self, uploads_playlist_id: str, *, max_results: int = 20
    ) -> list[str]:
        """업로드 플레이리스트에서 최신 영상 ID 목록 (max 50)."""
        data = self._get(
            "playlistItems",
            part="contentDetails",
            playlistId=uploads_playlist_id,
            maxResults=min(max_results, 50),
        )
        return [
            it["contentDetails"]["videoId"]
            for it in data.get("items", [])
            if it.get("contentDetails", {}).get("videoId")
        ]

    def fetch_videos(self, video_ids: list[str]) -> list[YoutubeVideo]:
        """videoId 배치 → 상세 메타. 50개씩 끊어서 요청."""
        out: list[YoutubeVideo] = []
        for i in range(0, len(video_ids), 50):
            chunk = video_ids[i : i + 50]
            data = self._get(
                "videos",
                part="snippet,contentDetails,statistics",
                id=",".join(chunk),
            )
            for it in data.get("items", []):
                video = _normalize_video(it)
                if video is not None:
                    out.append(video)
        return out

    def list_recent(
        self,
        channel_id: str,
        *,
        max_results: int = 20,
        uploads_playlist_id: str | None = None,
    ) -> tuple[list[YoutubeVideo], str]:
        """high-level 헬퍼: (영상 리스트, uploads_playlist_id)."""
        playlist_id = uploads_playlist_id or self.resolve_uploads_playlist(channel_id)
        ids = self.list_recent_video_ids(playlist_id, max_results=max_results)
        if not ids:
            return [], playlist_id
        return self.fetch_videos(ids), playlist_id


# --------------------------------------------------------------------- helpers


def _normalize_video(item: dict[str, Any]) -> YoutubeVideo | None:
    snippet = item.get("snippet") or {}
    content = item.get("contentDetails") or {}
    stats = item.get("statistics") or {}

    video_id = item.get("id")
    title = (snippet.get("title") or "").strip()
    if not video_id or not title:
        return None

    description = (snippet.get("description") or "").strip()
    if len(description) > DESCRIPTION_MAX_LEN:
        description = description[: DESCRIPTION_MAX_LEN - 1].rstrip() + "…"

    published_at_raw = snippet.get("publishedAt")
    published_at = (
        datetime.fromisoformat(published_at_raw.replace("Z", "+00:00"))
        if published_at_raw
        else datetime.now()
    )

    return YoutubeVideo(
        video_id=video_id,
        channel_id=snippet.get("channelId") or "",
        channel_title=snippet.get("channelTitle"),
        title=title,
        description=description or None,
        thumbnail_url=_pick_thumbnail(snippet.get("thumbnails", {})),
        duration_sec=_iso_duration_to_sec(content.get("duration")),
        view_count=int(stats["viewCount"]) if stats.get("viewCount") else None,
        published_at=published_at,
        raw=item,
    )


def _pick_thumbnail(thumbs: dict[str, Any]) -> str:
    """maxres > standard > high > medium > default 폴백."""
    for size in ("maxres", "standard", "high", "medium", "default"):
        url = thumbs.get(size, {}).get("url")
        if url:
            return url
    return ""


def _iso_duration_to_sec(iso: str | None) -> int | None:
    """ISO8601 PT#H#M#S → 초. 라이브/upcoming은 'P0D' 등 비표준 가능."""
    if not iso:
        return None
    m = _ISO_DURATION_RE.match(iso)
    if not m:
        return None
    h = int(m.group("h") or 0)
    mi = int(m.group("m") or 0)
    s = int(m.group("s") or 0)
    return h * 3600 + mi * 60 + s
