"""Sync KRA RSS 공지/뉴스 → `kra_news` 테이블 (UPSERT, ETag 캐싱)."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.kra_rss import KraRssClient, RssItem
from ..config import settings
from ..db import session_scope
from ..logging import get_logger
from ..models import KraNews, SyncMeta

log = get_logger(__name__)
SOURCE = "kra_rss"


def _to_row(item: RssItem) -> dict[str, Any]:
    return {
        "guid": item.guid,
        "title": item.title,
        "summary": item.summary,
        "link": item.link,
        "category": item.category,
        "image_url": item.image_url,
        "published_at": item.published_at,
        "source": "KRA",
        "raw": item.raw,
    }


def upsert_news(items: list[RssItem]) -> int:
    rows = [_to_row(it) for it in items]
    if not rows:
        return 0

    stmt = pg_insert(KraNews).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[KraNews.guid],
        set_={
            "title": stmt.excluded.title,
            "summary": stmt.excluded.summary,
            "link": stmt.excluded.link,
            "category": stmt.excluded.category,
            "image_url": stmt.excluded.image_url,
            "published_at": stmt.excluded.published_at,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("kra_news_upserted", count=len(rows))
    return len(rows)


def sync_news() -> int:
    """RSS 한 번 fetch → DB UPSERT. 304면 0 반환. 호출 결과를 sync_meta에 기록."""
    with session_scope() as s:
        meta = s.get(SyncMeta, SOURCE)
        prev_etag = meta.etag if meta else None
        prev_modified = meta.last_modified if meta else None

    error: str | None = None
    count = 0
    new_etag: str | None = prev_etag
    new_modified: str | None = prev_modified

    try:
        with KraRssClient(settings.kra_rss_url) as client:
            result = client.fetch(etag=prev_etag, last_modified=prev_modified)

        if result.not_modified:
            log.info("kra_news_not_modified")
        else:
            count = upsert_news(result.items)
            new_etag = result.etag or prev_etag
            new_modified = result.last_modified or prev_modified
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        log.error("kra_news_sync_failed", error=error)
        raise
    finally:
        _record_meta(
            etag=new_etag,
            last_modified=new_modified,
            success=error is None,
            error=error,
        )

    return count


def _record_meta(
    *,
    etag: str | None,
    last_modified: str | None,
    success: bool,
    error: str | None,
) -> None:
    now = datetime.now(tz=UTC)
    values = {
        "source": SOURCE,
        "last_run_at": now,
        "last_success_at": now if success else None,
        "etag": etag,
        "last_modified": last_modified,
        "last_error": error,
    }
    stmt = pg_insert(SyncMeta).values(values)
    set_ = {
        "last_run_at": stmt.excluded.last_run_at,
        "etag": stmt.excluded.etag,
        "last_modified": stmt.excluded.last_modified,
        "last_error": stmt.excluded.last_error,
        "updated_at": func.now(),
    }
    if success:
        set_["last_success_at"] = stmt.excluded.last_success_at
    stmt = stmt.on_conflict_do_update(index_elements=[SyncMeta.source], set_=set_)
    with session_scope() as s:
        s.execute(stmt)


def smoke_news() -> list[RssItem]:
    """Fetch once and return parsed items (no DB write). Used by `mal smoke-news`."""
    with KraRssClient(settings.kra_rss_url) as client:
        result = client.fetch()
    return result.items
