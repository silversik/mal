"""Sync 기상청 ASOS 일자료 → `weather_observations`.

3개 관측소 (수원119/제주184/부산159) 일통계를 upsert. 신뢰 가능한 데이터 확정이
관측 다음날 늦게(보통 정오 전) 이뤄지므로 매일 03시 KST 에 직전 7일을 재수집해
누락/지연 케이스를 보정한다. 청크/전체 backfill 은 별도 함수.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.kma_asos import (
    ALL_STATIONS,
    KmaAsosClient,
    api_item_to_weather_fields,
)
from ..db import session_scope
from ..logging import get_logger
from ..models import WeatherObservation

log = get_logger(__name__)


def upsert_weather(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    # batch 내 동일 (station_id, obs_date) dedupe — KMA 가 같은 day 를 중복 응답하지는
    # 않지만, 안전 차원.
    seen: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        seen[(r["station_id"], r["obs_date"])] = r
    unique = list(seen.values())

    stmt = pg_insert(WeatherObservation).values(unique)
    update_set = {
        "avg_ta": stmt.excluded.avg_ta,
        "min_ta": stmt.excluded.min_ta,
        "max_ta": stmt.excluded.max_ta,
        "sum_rn": stmt.excluded.sum_rn,
        "avg_ws": stmt.excluded.avg_ws,
        "avg_rhm": stmt.excluded.avg_rhm,
        "iscs": stmt.excluded.iscs,
        "raw": stmt.excluded.raw,
        "updated_at": func.now(),
    }
    stmt = stmt.on_conflict_do_update(
        index_elements=["station_id", "obs_date"],
        set_=update_set,
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("weather_upserted", count=len(unique))
    return len(unique)


def _fetch_station(client: KmaAsosClient, station_id: int, start: date, end: date) -> int:
    items = client.fetch_daily(station_id, start, end)
    normalized = [r for r in (api_item_to_weather_fields(it) for it in items) if r]
    if not normalized:
        return 0
    return upsert_weather(normalized)


def sync_range(start: date, end: date) -> int:
    """[start, end] 모든 관측소 일자료 upsert."""
    if start > end:
        raise ValueError(f"start({start}) > end({end})")
    total = 0
    with KmaAsosClient() as client:
        for stn in ALL_STATIONS:
            try:
                total += _fetch_station(client, stn, start, end)
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "weather_station_failed",
                    station=stn, start=str(start), end=str(end), err=str(e),
                )
    return total


def sync_recent(days: int = 7) -> int:
    """직전 `days` 일치 일자료 갱신 — 일일 cron 용. 관측 확정 지연 대비 안전 마진."""
    today = date.today()
    return sync_range(today - timedelta(days=days), today)


def backfill(start: date, end: date, *, chunk_days: int = 90) -> int:
    """과거 백필 — chunk_days 단위로 끊어 호출 (서버 응답 행수 한도 회피)."""
    if start > end:
        raise ValueError(f"start({start}) > end({end})")
    total = 0
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)
        n = sync_range(cursor, chunk_end)
        log.info(
            "weather_backfill_chunk",
            start=str(cursor), end=str(chunk_end), upserted=n,
        )
        total += n
        cursor = chunk_end + timedelta(days=1)
    log.info("weather_backfill_done", start=str(start), end=str(end), upserted=total)
    return total
