"""Periodic entry points wrapped with @track_job.

이 모듈의 함수들은 systemd timer 가 직접 호출하는 "스케줄된" 실행 지점이며,
각 실행은 `scraper_runs` 에 기록된다. 기존 CLI 명령 (`sync-news`, `sync-today`
등) 은 ad-hoc 수동 용도로 남겨두고, 자동 실행은 이쪽으로 호출한다.

job_key 는 `scraper_jobs` seed 와 1:1 대응 — 새 job 을 추가하려면
migration 에 seed row 를 넣고 여기에 래퍼를 추가.
"""
from __future__ import annotations

from datetime import date

from ..monitoring import track_job
from .sync_horses import backfill_missing_raw
from .sync_jockeys import sync_all_jockeys
from .sync_news import sync_news
from .sync_races import sync_date_all_meets
from .sync_videos import sync_videos


@track_job("sync_news")
def run_sync_news() -> int:
    return sync_news()


@track_job("sync_videos")
def run_sync_videos() -> int:
    return sync_videos(max_results=20)


@track_job("sync_races_today")
def run_sync_races_today() -> int:
    return sync_date_all_meets(date.today())


@track_job("sync_jockeys")
def run_sync_jockeys() -> int:
    return sync_all_jockeys()


@track_job("sync_horses_backfill")
def run_sync_horses_backfill() -> int:
    return backfill_missing_raw()
