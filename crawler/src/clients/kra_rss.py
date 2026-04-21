"""KRA 공식 공지/뉴스 RSS 클라이언트.

설계 원칙
- **저작권**: <description>은 HTML 태그 제거 후 500자까지만 보관. 본문 크롤링 금지.
- **대역폭 절약**: ETag / If-Modified-Since 사용 → 304면 빈 결과 반환.
- **방어적 파싱**: feed 별 비표준 필드(<dc:date>, atom:updated 등)도 published_at 후보로 시도.
- **시간대**: pubDate에 tz 정보가 없으면 KST(+09:00)로 가정 (KRA 게시판 운영 시간대).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from html import unescape
from typing import Any

import feedparser
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

# Asia/Seoul (KRA 공지의 사실상 기본 시간대)
KST = timezone(timedelta(hours=9))

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
_IMG_SRC_RE = re.compile(r"""<img[^>]+src=["']([^"']+)["']""", re.IGNORECASE)
SUMMARY_MAX_LEN = 500


@dataclass(frozen=True)
class RssItem:
    guid: str
    title: str
    summary: str | None
    link: str
    category: str | None
    image_url: str | None
    published_at: datetime
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RssResult:
    items: list[RssItem]
    not_modified: bool = False
    etag: str | None = None
    last_modified: str | None = None
    feed_title: str | None = None


class KraRssClient:
    """RSS 단일 피드 클라이언트. context manager로 사용 권장."""

    def __init__(self, url: str, timeout: float = 15.0) -> None:
        if not url:
            raise ValueError("KRA RSS URL is empty")
        self.url = url
        # KRA 게시판은 http이지만 동일 호스트 https도 동작하는 경우가 많음.
        # 일단 그대로 호출하되 redirect는 따라간다.
        self._client = httpx.Client(
            timeout=httpx.Timeout(timeout, connect=5.0),
            follow_redirects=True,
            headers={
                "User-Agent": "mal.kr-collector/0.1 (+rss)",
                "Accept": "application/rss+xml, application/xml, text/xml, */*",
            },
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> KraRssClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    @retry(
        reraise=True,
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type(httpx.TransportError),
        before_sleep=before_sleep_log(log, 30),
    )
    def fetch(
        self,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> RssResult:
        headers: dict[str, str] = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        resp = self._client.get(self.url, headers=headers)
        if resp.status_code == 304:
            log.info("rss_not_modified", url=self.url)
            return RssResult(items=[], not_modified=True, etag=etag, last_modified=last_modified)
        resp.raise_for_status()

        # feedparser는 bytes를 먹는 게 가장 안전 (인코딩 자동 감지)
        feed = feedparser.parse(resp.content)
        if feed.bozo and not feed.entries:
            log.warning(
                "rss_parse_error",
                url=self.url,
                exc=str(feed.bozo_exception) if hasattr(feed, "bozo_exception") else None,
            )

        items = [_normalize(e, fallback_link=self.url) for e in feed.entries]
        items = [it for it in items if it is not None]

        return RssResult(
            items=items,
            etag=resp.headers.get("ETag"),
            last_modified=resp.headers.get("Last-Modified"),
            feed_title=getattr(feed.feed, "title", None),
        )


# --------------------------------------------------------------------- helpers


def _normalize(entry: Any, *, fallback_link: str) -> RssItem | None:
    """feedparser entry → RssItem. 필수 필드(title, link)가 비면 None."""
    title = (entry.get("title") or "").strip()
    link = (entry.get("link") or "").strip()
    if not title or not link:
        return None

    summary_raw = (
        entry.get("summary")
        or entry.get("description")
        or (entry.get("content", [{}])[0].get("value") if entry.get("content") else None)
        or ""
    )
    summary = _clean_summary(summary_raw)
    image_url = _extract_image(entry, summary_raw)

    published_at = _parse_published(entry) or datetime.now(tz=KST)
    guid = (entry.get("id") or entry.get("guid") or _hash_guid(link, title)).strip()

    category = None
    if entry.get("tags"):
        first_tag = entry.tags[0]
        category = getattr(first_tag, "term", None) or first_tag.get("term")
    elif entry.get("category"):
        category = entry.get("category")

    return RssItem(
        guid=guid,
        title=title,
        summary=summary or None,
        link=link,
        category=category,
        image_url=image_url,
        published_at=published_at,
        raw=dict(entry),
    )


def _extract_image(entry: Any, summary_html: str) -> str | None:
    """Try common RSS image conventions, then fall back to first <img> in HTML."""
    # 1) MediaRSS: <media:thumbnail url="..."/> or <media:content medium="image"/>
    for attr in ("media_thumbnail", "media_content"):
        items = entry.get(attr)
        if items:
            for it in items:
                url = it.get("url") if isinstance(it, dict) else None
                medium = it.get("medium") if isinstance(it, dict) else None
                if url and (medium in (None, "image") or attr == "media_thumbnail"):
                    return url
    # 2) <enclosure url="..." type="image/*"/>
    for enc in entry.get("enclosures") or []:
        href = enc.get("href") if isinstance(enc, dict) else None
        ctype = (enc.get("type") if isinstance(enc, dict) else "") or ""
        if href and ctype.startswith("image/"):
            return href
    # 3) HTML 본문 첫 <img src="..."/>
    if summary_html:
        m = _IMG_SRC_RE.search(summary_html)
        if m:
            return m.group(1)
    return None


def _clean_summary(text: str) -> str:
    """HTML 태그 제거 + 엔티티 디코딩 + 공백 정규화 + 500자 컷 (저작권 준수)."""
    if not text:
        return ""
    no_html = _HTML_TAG_RE.sub(" ", text)
    decoded = unescape(no_html)
    normalized = _WHITESPACE_RE.sub(" ", decoded).strip()
    if len(normalized) > SUMMARY_MAX_LEN:
        normalized = normalized[: SUMMARY_MAX_LEN - 1].rstrip() + "…"
    return normalized


def _parse_published(entry: Any) -> datetime | None:
    """문자열에 KST/JST가 있으면 그쪽이 정확. 없으면 feedparser의 struct_time 신뢰.

    feedparser는 'KST', 'JST' 같은 비표준 zone을 모르고 통째로 UTC로 던져서
    9시간 어긋남이 발생함 → 원문 문자열을 우선 파싱한 뒤 폴백.
    """
    raw_strings: list[str] = [
        s for s in (entry.get(k) for k in ("published", "updated", "pubDate", "dc_date")) if s
    ]

    # 1) KST/JST 표기가 있으면 무조건 문자열 파싱 (feedparser 결과는 +9h 어긋남)
    from email.utils import parsedate_to_datetime

    for s in raw_strings:
        if " KST" in s or " JST" in s:
            try:
                normalized = s.replace(" KST", " +0900").replace(" JST", " +0900")
                dt = parsedate_to_datetime(normalized)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=KST)
                return dt.astimezone(UTC)
            except (TypeError, ValueError):
                continue

    # 2) feedparser가 정규화한 struct_time 사용
    for attr in ("published_parsed", "updated_parsed", "created_parsed"):
        struct = entry.get(attr)
        if struct:
            return datetime(*struct[:6], tzinfo=UTC)

    # 3) 표준 RFC822/ISO 문자열 마지막 폴백
    for s in raw_strings:
        try:
            dt = parsedate_to_datetime(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=KST)
            return dt.astimezone(UTC)
        except (TypeError, ValueError):
            continue
    return None


def _hash_guid(link: str, title: str) -> str:
    h = hashlib.sha1(f"{link}|{title}".encode()).hexdigest()
    return f"sha1:{h}"
