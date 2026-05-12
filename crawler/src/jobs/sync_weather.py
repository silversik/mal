"""Sync 기상청 ASOS 시간자료 → `weather_observations`.

3개 관측소 (수원119/제주184/부산159) 시간 단위 관측치를 upsert. 경마 발주시각
기준 매칭이 필요해서 일자료 대신 시간자료를 사용한다.

매일 03:00 KST 에 직전 7일(=24h×7×3 ≈ 504행)을 재수집해 관측 확정 지연을 보정.
백필은 chunk_days 단위(기본 30일 = 720행/관측소)로 분할.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.kma_asos import (
    ALL_STATIONS,
    KST,
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
    # batch 내 동일 (station_id, obs_time) dedupe — 안전 차원.
    seen: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        seen[(r["station_id"], r["obs_time"])] = r
    unique = list(seen.values())

    stmt = pg_insert(WeatherObservation).values(unique)
    update_set = {
        "ta": stmt.excluded.ta,
        "rn": stmt.excluded.rn,
        "ws": stmt.excluded.ws,
        "wd": stmt.excluded.wd,
        "hm": stmt.excluded.hm,
        "raw": stmt.excluded.raw,
        "updated_at": func.now(),
    }
    stmt = stmt.on_conflict_do_update(
        index_elements=["station_id", "obs_time"],
        set_=update_set,
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("weather_upserted", count=len(unique))
    return len(unique)


def _fetch_station(
    client: KmaAsosClient, station_id: int, start: datetime, end: datetime,
) -> int:
    items = client.fetch_hourly(station_id, start, end)
    normalized = [r for r in (api_item_to_weather_fields(it) for it in items) if r]
    if not normalized:
        return 0
    return upsert_weather(normalized)


def _kst(d: date, hour: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hour, tzinfo=KST)


def sync_range(start_date: date, end_date: date) -> int:
    """[start_date 00:00, end_date 23:00] 모든 관측소 시간자료 upsert."""
    if start_date > end_date:
        raise ValueError(f"start({start_date}) > end({end_date})")
    start = _kst(start_date, 0)
    end = _kst(end_date, 23)
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
    """직전 `days` 일치 시간자료 갱신 — 일일 cron 용. 관측 확정 지연 대비 안전 마진."""
    today = date.today()
    return sync_range(today - timedelta(days=days), today)


def backfill(start: date, end: date, *, chunk_days: int = 30) -> int:
    """과거 백필 — chunk_days 단위로 끊어 호출 (시간자료 응답 행수 한도 회피).

    30일 × 24시 × 1관측소 = 720행. numOfRows=999 페이지 한 번에 가능.
    """
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
