"""Container-internal APScheduler — replaces host systemd timers.

기존 `systemd/mal-collector-*.timer` 스펙을 그대로 이식. 각 job 함수는 이미
`@track_job` 로 감싸져 있어 대시보드 리포트는 자동. 이 모듈은 스케줄링만.

Usage:
    python -m src.scheduler_main

Dockerfile CMD 에서 기동 — 호스트 systemd 타이머 의존성 제거.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from crawler_core import client as dash

from .jobs.periodic import (
    run_chunked_dividends_backfill,
    run_sync_horse_ratings,
    run_sync_horses_backfill,
    run_sync_horses_refresh,
    run_sync_jockey_changes,
    run_sync_jockeys,
    run_sync_news,
    run_sync_owners,
    run_sync_race_dividends,
    run_sync_race_entries,
    run_sync_race_info,
    run_sync_race_plan,
    run_sync_race_sales,
    run_sync_races_today,
    run_sync_trainers,
    run_sync_videos,
    run_sync_videos_backfill,
)
from .logging import configure_logging, get_logger
from .monitoring import register_all_jobs

configure_logging()
log = get_logger("scheduler")

KST = "Asia/Seoul"


def main() -> None:
    # 대시보드에 JOB_CATALOG upsert. 실패해도 job 실행은 계속 — lazy 재시도는 @track_job 이 함.
    try:
        register_all_jobs()
    except Exception as e:  # noqa: BLE001
        log.warning("register_all_jobs_failed", err=str(e))

    sched = BlockingScheduler(timezone=KST)

    # 기존 systemd timer 와 동일한 스펙. `coalesce=True` 로 과거 누락된 실행은 1번만 재현.
    # `max_instances=1` 로 중복 실행 방지 (sleep_sec × 장시간 러닝 job 들).
    common = {"coalesce": True, "max_instances": 1, "misfire_grace_time": 600}

    # 30분 주기
    sched.add_job(
        run_sync_news, IntervalTrigger(minutes=30), id="mal.sync_news", **common,
    )
    # 3시간 주기
    sched.add_job(
        run_sync_videos, IntervalTrigger(hours=3), id="mal.sync_videos", **common,
    )
    sched.add_job(
        run_sync_race_entries,
        IntervalTrigger(hours=3),
        id="mal.sync_race_entries",
        **common,
    )
    # 매일 KST 고정 시각
    # 자정 KRA 쿼터 리셋 직후, 모닝 sync 잡들 전에 야간 청크 백필 1회.
    sched.add_job(
        run_chunked_dividends_backfill,
        CronTrigger(hour=2, minute=30),
        id="mal.chunked_dividends_backfill",
        **common,
    )
    sched.add_job(
        run_sync_race_plan,
        CronTrigger(hour=5, minute=0),
        id="mal.sync_race_plan",
        **common,
    )
    sched.add_job(
        run_sync_jockeys,
        CronTrigger(hour=6, minute=0),
        id="mal.sync_jockeys",
        **common,
    )
    # 기수와 동일한 마스터 데이터 — sync_jockeys 직후 실행.
    sched.add_job(
        run_sync_trainers,
        CronTrigger(hour=6, minute=15),
        id="mal.sync_trainers",
        **common,
    )
    # 마주 마스터 — trainers 직후, 같은 마스터 데이터 묶음.
    sched.add_job(
        run_sync_owners,
        CronTrigger(hour=6, minute=20),
        id="mal.sync_owners",
        **common,
    )
    # 기수변경 이벤트 — owners 직후. KRA 기본 윈도우(~1개월) 매일 idempotent UPSERT.
    sched.add_job(
        run_sync_jockey_changes,
        CronTrigger(hour=6, minute=25),
        id="mal.sync_jockey_changes",
        **common,
    )
    sched.add_job(
        run_sync_horses_backfill,
        CronTrigger(hour=6, minute=30),
        id="mal.sync_horses_backfill",
        **common,
    )
    sched.add_job(
        run_sync_horses_refresh,
        CronTrigger(hour=7, minute=0),
        id="mal.sync_horses_refresh",
        **common,
    )
    # 주 1회 토요일 — KRA 레이팅 공시 주기에 맞춤.
    sched.add_job(
        run_sync_horse_ratings,
        CronTrigger(day_of_week="sat", hour=7, minute=30),
        id="mal.sync_horse_ratings",
        **common,
    )
    sched.add_job(
        run_sync_races_today,
        CronTrigger(hour=22, minute=0),
        id="mal.sync_races_today",
        **common,
    )
    # 결과 수집(22:00) 직후 메타 백필(22:30) — races.race_name/distance/grade/track_type 채움.
    sched.add_job(
        run_sync_race_info,
        CronTrigger(hour=22, minute=30),
        id="mal.sync_race_info",
        **common,
    )
    # 메타 백필 직후 확정배당율(22:45) — race_dividends 적재.
    sched.add_job(
        run_sync_race_dividends,
        CronTrigger(hour=22, minute=45),
        id="mal.sync_race_dividends",
        **common,
    )
    # 배당 직후 풀별 매출(22:50) — race_pool_sales 적재.
    sched.add_job(
        run_sync_race_sales,
        CronTrigger(hour=22, minute=50),
        id="mal.sync_race_sales",
        **common,
    )
    # 메타 백필 다음 영상 매칭(23:00) — 누락된 경주에 KRBC YouTube search 로 upsert.
    sched.add_job(
        run_sync_videos_backfill,
        CronTrigger(hour=23, minute=0),
        id="mal.sync_videos_backfill",
        **common,
    )

    # 대시보드 "지금 실행" 트리거 폴링 — 15초마다 pending_trigger 확인해서 즉시 실행.
    # 각 job id 는 위 add_job 의 id 와 동일 key 를 사용 (대시보드 UI 와 1:1).
    # 주의: `run_chunked_dividends_backfill` 과 `mal.backfill_history` 는 수동 전용이라
    # 특수 취급 — history 는 별도 CLI 로 돌리던 것이지만 dash 트리거 오면 여기서 실행.
    TRIGGER_JOBS = {
        "mal.sync_news": run_sync_news,
        "mal.sync_videos": run_sync_videos,
        "mal.sync_videos_backfill": run_sync_videos_backfill,
        "mal.sync_race_entries": run_sync_race_entries,
        "mal.sync_race_plan": run_sync_race_plan,
        "mal.sync_jockeys": run_sync_jockeys,
        "mal.sync_trainers": run_sync_trainers,
        "mal.sync_owners": run_sync_owners,
        "mal.sync_jockey_changes": run_sync_jockey_changes,
        "mal.sync_horses_backfill": run_sync_horses_backfill,
        "mal.sync_horses_refresh": run_sync_horses_refresh,
        "mal.sync_horse_ratings": run_sync_horse_ratings,
        "mal.sync_races_today": run_sync_races_today,
        "mal.sync_race_info": run_sync_race_info,
        "mal.sync_race_dividends": run_sync_race_dividends,
        "mal.sync_race_sales": run_sync_race_sales,
        "mal.chunked_dividends_backfill": run_chunked_dividends_backfill,
    }

    def _trigger_poll() -> None:
        dash.poll_and_dispatch(TRIGGER_JOBS)

    sched.add_job(
        _trigger_poll,
        IntervalTrigger(seconds=15),
        id="mal.trigger_poll",
        coalesce=True,
        max_instances=1,
        misfire_grace_time=30,
    )

    log.info(
        "scheduler_starting",
        tz=KST,
        jobs=[j.id for j in sched.get_jobs()],
    )

    try:
        sched.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("scheduler_shutdown_signal")
    finally:
        log.info("scheduler_stopped")


if __name__ == "__main__":
    main()
