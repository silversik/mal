"""Periodic entry points wrapped with @track_job.

이 모듈의 함수들은 systemd timer 가 직접 호출하는 "스케줄된" 실행 지점이며,
각 실행은 `scraper_runs` 에 기록된다. 기존 CLI 명령 (`sync-news`, `sync-today`
등) 은 ad-hoc 수동 용도로 남겨두고, 자동 실행은 이쪽으로 호출한다.

job_key 는 `scraper_jobs` seed 와 1:1 대응 — 새 job 을 추가하려면
migration 에 seed row 를 넣고 여기에 래퍼를 추가.
"""
from __future__ import annotations

from datetime import date

from ..config import settings
from ..logging import get_logger
from ..monitoring import track_job
from .sync_horses import backfill_missing_raw
from .sync_jockeys import sync_all_jockeys
from .sync_news import sync_news
from .sync_race_entries import sync_upcoming as sync_upcoming_race_entries
from .sync_race_plan import sync_current_year as sync_current_race_plan
from .sync_races import sync_date_all_meets
from .sync_videos import sync_videos

log = get_logger(__name__)


@track_job("mal.sync_news")
def run_sync_news() -> int:
    return sync_news()


@track_job("mal.sync_videos")
def run_sync_videos() -> int:
    if not settings.youtube_api_key or not settings.youtube_krbc_channel_id:
        log.warning(
            "sync_videos_skipped_missing_config",
            reason="YOUTUBE_API_KEY / YOUTUBE_KRBC_CHANNEL_ID 미설정",
        )
        return 0
    return sync_videos(max_results=20)


@track_job("mal.sync_races_today")
def run_sync_races_today() -> int:
    return sync_date_all_meets(date.today())


@track_job("mal.sync_jockeys")
def run_sync_jockeys() -> int:
    return sync_all_jockeys()


@track_job("mal.sync_horses_backfill")
def run_sync_horses_backfill() -> int:
    return backfill_missing_raw()


@track_job("mal.sync_race_plan")
def run_sync_race_plan() -> int:
    return sync_current_race_plan()


@track_job("mal.sync_race_entries")
def run_sync_race_entries() -> int:
    if not settings.kra_chulma_operation:
        log.warning(
            "sync_race_entries_skipped_missing_config",
            reason="KRA_CHULMA_OPERATION 미설정 — Swagger 확인 후 .env 에 추가",
        )
        return 0
    return sync_upcoming_race_entries(days_ahead=10)
