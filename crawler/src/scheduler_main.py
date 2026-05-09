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
    run_audit_combo_dividends,
    run_build_favorite_notifications,
    run_backfill_races_from_entries,
    run_chunked_dividends_backfill,
    run_settle_bets,
    run_sync_horse_rank_changes,
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
    run_sync_race_corners,
    run_sync_race_sales,
    run_sync_race_today_meta,
    run_sync_races_live,
    run_sync_races_today,
    run_sync_yesterday_residual,
    run_sync_trainers,
    run_sync_videos,
    run_sync_videos_backfill,
    run_sync_videos_bulk,
    run_sync_weather,
    run_sync_yesterday_catchup,
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
    # 10분 주기 — 모의배팅 정산. 결과 적재 직후 자동으로 PENDING bets 정산.
    sched.add_job(
        run_settle_bets,
        IntervalTrigger(minutes=10),
        id="mal.settle_bets",
        **common,
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
    # race_entries sync 후 races.distance/grade/start_time 빈 컬럼 백필.
    # API187 미응답 영구 fallback — 매 3시간(엔트리 sync 와 동일 주기).
    sched.add_job(
        run_backfill_races_from_entries,
        IntervalTrigger(hours=3),
        id="mal.backfill_races_from_entries",
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
    # 마필 등급변동 이력 — 매일 06:35 KST. 누적 ~5000 row 전체 fetch + UPSERT.
    sched.add_job(
        run_sync_horse_rank_changes,
        CronTrigger(hour=6, minute=35),
        id="mal.sync_horse_rank_changes",
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
    # 전날 경주결과·배당·매출 누락 보정 — 22:00 sync 실패/KRA 지연 대비 다음날 07:30 재수집.
    sched.add_job(
        run_sync_yesterday_catchup,
        CronTrigger(hour=7, minute=30),
        id="mal.sync_yesterday_catchup",
        **common,
    )
    sched.add_job(
        run_sync_races_today,
        CronTrigger(hour=22, minute=0),
        id="mal.sync_races_today",
        **common,
    )
    # 경기일 실시간 결과·배당 동기화 — KST 10:00~22:30 매 30분.
    # 단일 22:00 sync_races_today 잡 실패 시 그날 결과가 통째로 비는 사고를
    # 방지하기 위한 in-day backstop. 비경기일이면 함수 내부에서 _has_races_on
    # 게이트로 즉시 skip — KRA 호출도, 실패 알림도 발생하지 않는다.
    sched.add_job(
        run_sync_races_live,
        CronTrigger(hour="10-22", minute="0,30"),
        id="mal.sync_races_live",
        **common,
    )
    # 다음날 09~12시 잔여 catchup — sync_yesterday_catchup(07:30) 이후에도
    # KRA publish 지연으로 결과 누락이 남는 케이스 보충. DB 에 미해결 race
    # 가 있을 때만 KRA 호출, 모두 채워지면 즉시 skip.
    sched.add_job(
        run_sync_yesterday_residual,
        CronTrigger(hour="9-12", minute=0),
        id="mal.sync_yesterday_residual",
        **common,
    )
    # 결과 수집(22:00) 직후 메타 백필(22:30) — races.race_name/distance/grade/track_type 채움.
    # 그리고 당일 아침(05:30) 한 번 더 — sync_race_plan(05:00) 다음에 실행해서 KRA 가
    # 새벽에 갱신한 출주 시각·거리 정보를 출전표 노출 전에 races 테이블에 반영한다.
    # ⚠ 2026-05 현재 API187 은 빈 응답. 실제 backfill 은 sync_race_today_meta (HTML).
    sched.add_job(
        run_sync_race_info,
        CronTrigger(hour="5,22", minute=30),
        id="mal.sync_race_info",
        **common,
    )
    # 당일 발주시각·거리 HTML 크롤링 — race.kra.co.kr/seoulMain.do 파싱. KRA OpenAPI
    # API187 의 빈 응답을 보완하는 fallback. 06~21 매시 정각 5분.
    # 새벽엔 KRA 페이지가 어제 데이터를 보여주는 시간대도 있어 06시 이후로 시작.
    sched.add_job(
        run_sync_race_today_meta,
        CronTrigger(hour="6-21", minute=5),
        id="mal.sync_race_today_meta",
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
    # 매출 직후 통과순위·구간기록(22:55) — race_result_corners (KRA API4_2).
    # 활용신청 전엔 빈 응답이라 0 적재 — 신청 완료 시점에 자동 데이터 시작.
    sched.add_job(
        run_sync_race_corners,
        CronTrigger(hour=22, minute=55),
        id="mal.sync_race_corners",
        **common,
    )
    # 메타 백필 다음 영상 매칭(23:00) — 누락된 경주에 KRBC YouTube search 로 upsert.
    sched.add_job(
        run_sync_videos_backfill,
        CronTrigger(hour=23, minute=0),
        id="mal.sync_videos_backfill",
        **common,
    )
    # 모의배팅 복식 배당 누락 자가진단(23:10) — 결과·배당 백필 완료 후, 어제 race 점검.
    sched.add_job(
        run_audit_combo_dividends,
        CronTrigger(hour=23, minute=10),
        id="mal.audit_combo_dividends",
        **common,
    )
    # KRBC 업로드 플레이리스트 1년 walk — 월 1회(매월 1일 04:00 KST) 일괄 적재.
    # 영상 폭주(race day 30+ 영상)로 sync_videos head 에서 밀린 누락 영구 cover.
    # 수동 "지금 실행" 트리거로도 호출 가능.
    sched.add_job(
        run_sync_videos_bulk,
        CronTrigger(day=1, hour=4, minute=0),
        id="mal.sync_videos_bulk",
        **common,
    )
    # 즐겨찾기 마필 출주 → 인앱 알림 — sync_race_entries(3h) 보다 자주 회전.
    sched.add_job(
        run_build_favorite_notifications,
        IntervalTrigger(hours=1),
        id="mal.build_favorite_notifications",
        **common,
    )
    # 기상청 ASOS 일자료 — 매일 03:00 KST. 관측 확정 지연 대비 직전 7일 재수집.
    sched.add_job(
        run_sync_weather,
        CronTrigger(hour=3, minute=0),
        id="mal.sync_weather",
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
        "mal.sync_videos_bulk": run_sync_videos_bulk,
        "mal.sync_race_entries": run_sync_race_entries,
        "mal.sync_race_plan": run_sync_race_plan,
        "mal.sync_jockeys": run_sync_jockeys,
        "mal.sync_trainers": run_sync_trainers,
        "mal.sync_owners": run_sync_owners,
        "mal.sync_jockey_changes": run_sync_jockey_changes,
        "mal.sync_horse_rank_changes": run_sync_horse_rank_changes,
        "mal.sync_horses_backfill": run_sync_horses_backfill,
        "mal.sync_horses_refresh": run_sync_horses_refresh,
        "mal.sync_horse_ratings": run_sync_horse_ratings,
        "mal.sync_races_today": run_sync_races_today,
        "mal.sync_races_live": run_sync_races_live,
        "mal.sync_yesterday_catchup": run_sync_yesterday_catchup,
        "mal.sync_yesterday_residual": run_sync_yesterday_residual,
        "mal.sync_race_info": run_sync_race_info,
        "mal.sync_race_today_meta": run_sync_race_today_meta,
        "mal.sync_race_dividends": run_sync_race_dividends,
        "mal.sync_race_sales": run_sync_race_sales,
        "mal.sync_race_corners": run_sync_race_corners,
        "mal.backfill_races_from_entries": run_backfill_races_from_entries,
        "mal.chunked_dividends_backfill": run_chunked_dividends_backfill,
        "mal.settle_bets": run_settle_bets,
        "mal.audit_combo_dividends": run_audit_combo_dividends,
        "mal.build_favorite_notifications": run_build_favorite_notifications,
        "mal.sync_weather": run_sync_weather,
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
