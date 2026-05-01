"""네이버 뉴스 검색 → `kra_news` 테이블에 UPSERT.

기존 KRA RSS(`sync_news`) 를 대체. 마사회 자체 공지 대신 외부 언론 보도를 모은다.
사용자 클릭 시 `link` (originallink) 로 원본 언론사 페이지로 이동.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.naver_news import NaverNewsItem, NaverNewsSearchClient
from ..config import settings
from ..db import session_scope
from ..logging import get_logger
from ..models import KraNews

log = get_logger(__name__)

# 검색 키워드 — 너무 넓히면 무관 기사가 섞이고, 너무 좁히면 누락. 셋 정도가 적절.
DEFAULT_KEYWORDS = ("경마", "한국마사회", "렛츠런파크")


def _to_row(item: NaverNewsItem) -> dict[str, Any]:
    return {
        "guid": item.guid,
        "title": item.title,
        "summary": item.summary,
        "link": item.link,
        "category": None,
        "image_url": None,                                  # 검색 API 는 썸네일 미제공.
        "published_at": item.published_at,
        "source": item.source,
        "raw": item.raw,
    }


def _upsert(items: list[NaverNewsItem]) -> int:
    if not items:
        return 0
    rows = [_to_row(it) for it in items]
    stmt = pg_insert(KraNews).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[KraNews.guid],
        set_={
            "title": stmt.excluded.title,
            "summary": stmt.excluded.summary,
            "link": stmt.excluded.link,
            "source": stmt.excluded.source,
            "published_at": stmt.excluded.published_at,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    return len(rows)


def sync_naver_news(keywords: tuple[str, ...] = DEFAULT_KEYWORDS) -> int:
    """키워드 셋을 모두 검색해 합집합 UPSERT. 환경변수 미설정 시 0 반환."""
    if not (settings.naver_search_client_id and settings.naver_search_client_secret):
        log.warning(
            "sync_naver_news_skipped_missing_config",
            reason="NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 미설정",
        )
        return 0

    seen: dict[str, NaverNewsItem] = {}
    with NaverNewsSearchClient(
        settings.naver_search_client_id,
        settings.naver_search_client_secret,
    ) as client:
        for kw in keywords:
            try:
                items = client.search(kw, display=100, sort="date")
            except Exception as e:  # noqa: BLE001
                log.warning("naver_search_failed", keyword=kw, err=str(e))
                continue
            for it in items:
                # guid 가 같으면 더 최신 것으로 덮어씀 (다중 검색에서의 중복 처리).
                cur = seen.get(it.guid)
                if cur is None or it.published_at > cur.published_at:
                    seen[it.guid] = it
            log.info("naver_search_done", keyword=kw, fetched=len(items))

    inserted = _upsert(list(seen.values()))
    log.info("naver_news_upserted", count=inserted, distinct=len(seen))
    return inserted
