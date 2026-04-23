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
from .sync_horse_ratings import sync_all_meets as sync_horse_ratings_all_meets
from .sync_horses import backfill_missing_raw, refresh_stale_horses
from .sync_jockeys import sync_all_jockeys
from .sync_owners import sync_all_owners
from .sync_trainers import sync_all_trainers
from .sync_news import sync_news
from .sync_race_entries import sync_upcoming as sync_upcoming_race_entries
from .sync_race_info import backfill_races_metadata
from .sync_race_plan import sync_current_year as sync_current_race_plan
from .sync_race_dividends import sync_date_all_meets as sync_dividends_all_meets
from .sync_races import sync_date_all_meets
from .chunked_backfill_dividends import run_chunk as run_chunked_dividends_chunk
from .sync_videos import sync_videos
from .sync_videos_backfill import backfill_missing_race_videos

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


@track_job("mal.sync_horses_refresh")
def run_sync_horses_refresh() -> int:
    """매일 batch 만큼 회전시켜 stale horses (updated_at > 30d) 재조회."""
    return refresh_stale_horses(older_than_days=30, batch=300)


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


@track_job("mal.sync_race_info")
def run_sync_race_info() -> int:
    """API187 로 races 메타(이름/거리/등급/주로) 백필 — 22:30 KST."""
    return backfill_races_metadata()


@track_job("mal.sync_race_dividends")
def run_sync_race_dividends() -> int:
    """오늘 경주의 확정배당율 적재 — 결과 sync (22:00) 이후 22:45 KST."""
    return sync_dividends_all_meets(date.today())


@track_job("mal.sync_trainers")
def run_sync_trainers() -> int:
    """매일 06:15 KST — sync_jockeys (06:00) 직후."""
    return sync_all_trainers()


@track_job("mal.sync_owners")
def run_sync_owners() -> int:
    """매일 06:20 KST — trainers (06:15) 직후, 마스터 데이터 묶음."""
    return sync_all_owners()


@track_job("mal.sync_horse_ratings")
def run_sync_horse_ratings() -> int:
    """매주 KRA 공시 레이팅 적재 — 토요일 07:30 KST."""
    return sync_horse_ratings_all_meets()


@track_job("mal.chunked_dividends_backfill")
def run_chunked_dividends_backfill() -> int:
    """야간 청크 백필 — race_dividends 6개월 윈도우 역시간 진행.

    매일 KST 02:30 (자정 쿼터 리셋 직후, 모닝 sync 잡들 전) 1회 실행.
    각 호출 = 최대 ~15 (date, meet) sync_date 호출 = ~450~900 API page calls.
    cursor 는 mal.sync_meta(source='chunked_backfill_dividends') 에 영속.
    반환값: 이번 청크에서 upsert 한 row 수.
    """
    summary = run_chunked_dividends_chunk()
    return int(summary.get("added_rows", 0))


@track_job("mal.sync_videos_backfill")
def run_sync_videos_backfill() -> int:
    """누락된 경주 영상을 YouTube search 로 매칭 — 23:00 KST."""
    if not settings.youtube_api_key or not settings.youtube_krbc_channel_id:
        log.warning(
            "sync_videos_backfill_skipped_missing_config",
            reason="YOUTUBE_API_KEY / YOUTUBE_KRBC_CHANNEL_ID 미설정",
        )
        return 0
    return backfill_missing_race_videos(days_back=30, limit=50)
