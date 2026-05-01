"""네이버 검색 OpenAPI — 뉴스 검색.

Endpoint: https://openapi.naver.com/v1/search/news.json
Docs:     https://developers.naver.com/docs/serviceapi/search/news/news.md

쿼리 1회당 최대 100건, start 1..1000 까지 페이지네이션.
HTML 응답 필드 (<b>, &quot; 등) 는 caller 가 strip/unescape.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any
from urllib.parse import urlparse

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

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
SUMMARY_MAX_LEN = 500
ENDPOINT = "https://openapi.naver.com/v1/search/news.json"


@dataclass(frozen=True)
class NaverNewsItem:
    """네이버 검색 결과 1건. KraNews 적재 형식과 1:1 매핑되도록 정규화."""

    guid: str                               # link (보통 originallink, 없으면 link)
    title: str
    summary: str | None
    link: str                               # 사용자가 클릭하는 원본 언론사 URL
    source: str                             # 언론사 호스트 → 친근한 이름 fallback
    published_at: datetime
    raw: dict[str, Any] = field(default_factory=dict)


def _strip_html(text: str | None) -> str:
    if not text:
        return ""
    return _WHITESPACE_RE.sub(" ", _HTML_TAG_RE.sub("", unescape(text))).strip()


# 자주 등장하는 언론사 호스트 → 한국어 표기 매핑. 미매칭은 호스트 그대로 노출.
_HOST_LABEL: dict[str, str] = {
    "www.kookje.co.kr": "국제신문",
    "www.donga.com": "동아일보",
    "sports.donga.com": "스포츠동아",
    "www.chosun.com": "조선일보",
    "sports.chosun.com": "스포츠조선",
    "www.hankyung.com": "한국경제",
    "www.mk.co.kr": "매일경제",
    "news.naver.com": "네이버 뉴스",
    "n.news.naver.com": "네이버 뉴스",
    "biz.heraldcorp.com": "헤럴드경제",
    "biz.chosun.com": "조선비즈",
    "www.yna.co.kr": "연합뉴스",
    "www.newsis.com": "뉴시스",
    "www.news1.kr": "뉴스1",
    "sports.news.naver.com": "네이버 스포츠",
    "www.yonhapnewstv.co.kr": "연합뉴스TV",
    "www.kra.co.kr": "한국마사회",
}


def _source_label(link: str) -> str:
    try:
        host = urlparse(link).hostname or ""
    except ValueError:
        host = ""
    if not host:
        return "네이버 뉴스"
    if host in _HOST_LABEL:
        return _HOST_LABEL[host]
    # www. 접두사는 떼서 단순화.
    return host[4:] if host.startswith("www.") else host


class NaverNewsSearchClient:
    """`with` 컨텍스트로 사용. httpx.Client 한 개 공유."""

    def __init__(self, client_id: str, client_secret: str, timeout: float = 10.0):
        self._headers = {
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret,
            "User-Agent": "mal.kr-crawler/1.0",
        }
        self._client = httpx.Client(timeout=timeout, headers=self._headers)

    def __enter__(self) -> NaverNewsSearchClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self._client.close()

    @retry(
        retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.5, min=1, max=8),
        before_sleep=before_sleep_log(log, 30),  # WARN
        reraise=True,
    )
    def _fetch(self, params: dict[str, Any]) -> dict[str, Any]:
        r = self._client.get(ENDPOINT, params=params)
        r.raise_for_status()
        return r.json()

    def search(
        self,
        query: str,
        *,
        display: int = 100,
        start: int = 1,
        sort: str = "date",
    ) -> list[NaverNewsItem]:
        """단일 키워드 검색. 최신순(date) 기본, 최대 100건/회."""
        if not query.strip():
            return []
        data = self._fetch(
            {"query": query, "display": display, "start": start, "sort": sort}
        )
        out: list[NaverNewsItem] = []
        for raw in data.get("items", []):
            link = (raw.get("originallink") or raw.get("link") or "").strip()
            if not link:
                continue
            try:
                published = parsedate_to_datetime(raw.get("pubDate", ""))
            except (TypeError, ValueError):
                continue
            title = _strip_html(raw.get("title"))
            if not title:
                continue
            summary = _strip_html(raw.get("description"))
            if len(summary) > SUMMARY_MAX_LEN:
                summary = summary[:SUMMARY_MAX_LEN].rstrip() + "…"
            out.append(
                NaverNewsItem(
                    guid=link,                              # originallink 가 안정적인 자연키
                    title=title,
                    summary=summary or None,
                    link=link,
                    source=_source_label(link),
                    published_at=published,
                    raw=raw,
                )
            )
        return out
