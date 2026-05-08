"""Periodic entry points wrapped with @track_job.

이 모듈의 함수들은 systemd timer 가 직접 호출하는 "스케줄된" 실행 지점이며,
각 실행은 `scraper_runs` 에 기록된다. 기존 CLI 명령 (`sync-news`, `sync-today`
등) 은 ad-hoc 수동 용도로 남겨두고, 자동 실행은 이쪽으로 호출한다.

job_key 는 `scraper_jobs` seed 와 1:1 대응 — 새 job 을 추가하려면
migration 에 seed row 를 넣고 여기에 래퍼를 추가.
"""
from __future__ import annotations

import os
from datetime import date

import httpx

from ..config import settings
from ..logging import get_logger
from ..monitoring import track_job
from .sync_horse_rank_changes import sync_all as sync_horse_rank_changes_all
from .sync_horse_ratings import sync_all_meets as sync_horse_ratings_all_meets
from .sync_horses import backfill_missing_raw, refresh_stale_horses
from .sync_jockeys import sync_all_jockeys
from .sync_jockey_changes import sync_recent as sync_jockey_changes_recent
from .sync_owners import sync_all_owners
from .sync_trainers import sync_all_trainers
from .sync_favorite_notifications import build_favorite_notifications
from .sync_naver_news import sync_naver_news
from .sync_race_entries import sync_upcoming as sync_upcoming_race_entries
from .sync_race_info import backfill_races_metadata
from .sync_race_plan import sync_current_year as sync_current_race_plan
from .sync_race_dividends import sync_date_all_meets as sync_dividends_all_meets
from .sync_race_sales import sync_date_all_meets as sync_race_sales_all_meets
from .sync_races import sync_date_all_meets
from .chunked_backfill_dividends import run_chunk as run_chunked_dividends_chunk
from .sync_videos import sync_videos
from .sync_videos_backfill import backfill_missing_race_videos

log = get_logger(__name__)


@track_job("mal.sync_news")
def run_sync_news() -> int:
    """네이버 뉴스 검색 기반 마사회/경마 보도 수집.

    이전엔 KRA 공식 RSS 를 끌어왔으나, 외부 언론 기사 다양성을 위해 네이버 검색
    API 로 교체. job_key 는 동일 — 대시보드 이력/감시 룰을 그대로 사용한다.
    """
    return sync_naver_news()


@track_job("mal.sync_videos")
def run_sync_videos() -> int:
    # 환경변수 미설정 시 silent skip(return 0) 하면 scraper_runs 가 success 로
    # 기록되어 모니터링이 미수집 사고를 캐치하지 못한다 (mal.sync_race_entries
    # 의 KRA_CHULMA_OPERATION 미설정으로 4/25 이후 race_entries 0건 사고 참고).
    # 명시적 RuntimeError 로 전환하면 scraper_runs 가 failed 로 떨어져 즉시
    # 대시보드에 빨간 신호로 보인다.
    if not settings.youtube_api_key or not settings.youtube_krbc_channel_id:
        raise RuntimeError(
            "YOUTUBE_API_KEY / YOUTUBE_KRBC_CHANNEL_ID 미설정 — .env 에 추가 필요"
        )
    return sync_videos(max_results=20)


@track_job("mal.sync_races_today")
def run_sync_races_today() -> int:
    return sync_date_all_meets(date.today())


@track_job("mal.sync_races_live")
def run_sync_races_live() -> int:
    """경기일 실시간 업데이트 — 매시간 10~21시 KST.

    경기 진행 중 결과와 배당을 갱신한다. 비경기일이면 KRA API 가 0건을 반환하므로
    idempotent 하게 무해하게 실행된다.
    """
    races = sync_date_all_meets(date.today())
    dividends = sync_dividends_all_meets(date.today())
    log.info("races_live_done", races=races, dividends=dividends)
    return races + dividends


@track_job("mal.sync_yesterday_catchup")
def run_sync_yesterday_catchup() -> int:
    """전날 경주결과·배당·매출 누락 보정 — 매일 07:30 KST.

    22:00 KST sync 가 실패하거나 KRA API 가 결과 공표를 지연한 경우,
    다음날 아침에 전날 데이터를 재수집해 빈 날짜를 채운다.
    upsert 이므로 데이터가 이미 존재해도 안전하게 재실행.

    결과 적재 직후 모의배팅 정산도 즉시 트리거 — 10분 주기 잡을 기다리지 않도록.
    정산 실패해도 catchup 자체는 성공으로 본다 (정산 잡이 다음 cycle 에 재시도).
    """
    from datetime import timedelta
    yesterday = date.today() - timedelta(days=1)
    races = sync_date_all_meets(yesterday)
    dividends = sync_dividends_all_meets(yesterday)
    sales = sync_race_sales_all_meets(yesterday)
    try:
        run_settle_bets()
    except Exception as e:  # noqa: BLE001
        log.warning("yesterday_catchup_settle_failed", err=str(e))
    log.info("yesterday_catchup_done", date=str(yesterday), races=races, dividends=dividends, sales=sales)
    return races + dividends + sales


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
    # 4/25 ~ 5/8 구간에서 KRA_CHULMA_OPERATION 가 빈 값이라 매 3시간마다
    # success/0 으로 silent skip 되었고, race_entries 가 한 줄도 안 들어와
    # "오늘의 경주"·"다음 진행 예정 경기" 섹션이 빈 채로 노출된 사고가 있었음.
    # success/0 이라 모니터링이 캐치 못함 — 명시적 RuntimeError 로 전환해
    # scraper_runs 에 failed 로 기록되도록.
    if not settings.kra_chulma_operation:
        raise RuntimeError(
            "KRA_CHULMA_OPERATION 미설정 — data.go.kr Swagger 의 API26_2 "
            "operationId (예: entrySheet_2) 를 .env 에 추가하세요."
        )
    return sync_upcoming_race_entries(days_ahead=10)


@track_job("mal.sync_race_info")
def run_sync_race_info() -> int:
    """API187 로 races 메타(이름/거리/등급/주로) 백필 — 22:30 KST."""
    return backfill_races_metadata()


@track_job("mal.sync_race_dividends")
def run_sync_race_dividends() -> int:
    """오늘 경주의 확정배당율 적재 — 결과 sync (22:00) 이후 22:45 KST."""
    return sync_dividends_all_meets(date.today())


@track_job("mal.sync_race_sales")
def run_sync_race_sales() -> int:
    """오늘 경주의 풀별 매출 적재 — race_dividends (22:45) 직후 22:50 KST."""
    return sync_race_sales_all_meets(date.today())


@track_job("mal.sync_trainers")
def run_sync_trainers() -> int:
    """매일 06:15 KST — sync_jockeys (06:00) 직후."""
    return sync_all_trainers()


@track_job("mal.sync_owners")
def run_sync_owners() -> int:
    """매일 06:20 KST — trainers (06:15) 직후, 마스터 데이터 묶음."""
    return sync_all_owners()


@track_job("mal.sync_jockey_changes")
def run_sync_jockey_changes() -> int:
    """기수변경 이벤트 적재 — 매일 06:25 KST.

    KRA 기본 응답 윈도우(~1개월) 그대로 받아 idempotent UPSERT 하므로
    어제/오늘 새 이벤트는 자동 누적. 별도 백필 불필요.
    """
    return sync_jockey_changes_recent()


@track_job("mal.sync_horse_rank_changes")
def run_sync_horse_rank_changes() -> int:
    """경주마 등급변동 이력 — 매일 06:35 KST. 전체 ~5000 row idempotent UPSERT."""
    return sync_horse_rank_changes_all()


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


@track_job("mal.settle_bets")
def run_settle_bets() -> int:
    """모의배팅 정산 — Next.js `/api/internal/settle` 호출.

    정산 비즈니스 로직(적중 판정·배당 lookup·잔액 ledger)은 web 쪽 한 곳에만 있고,
    여기는 단순 트리거. 결과 row 가 있는데 race_settlements 에 없는 race 모두 처리.
    개별 race 는 web 쪽에서 자체 트랜잭션 + 멱등성(race_settlements PK + idem_key) 보장.

    env:
      MAL_WEB_INTERNAL_URL — 컨테이너 네트워크 내 Next.js (예: http://mal-web:4000)
      CRAWLER_SECRET       — X-Crawler-Secret 헤더 (timing-safe 검증)

    반환: bets_settled + bets_void (대시보드 rows_upserted 표시용).
    """
    base = os.environ.get("MAL_WEB_INTERNAL_URL", "").rstrip("/")
    secret = os.environ.get("CRAWLER_SECRET", "")
    if not base or not secret:
        log.warning(
            "settle_bets_skipped_missing_config",
            reason="MAL_WEB_INTERNAL_URL / CRAWLER_SECRET 미설정",
        )
        return 0
    url = f"{base}/api/internal/settle"
    try:
        resp = httpx.post(
            url,
            headers={"x-crawler-secret": secret, "content-type": "application/json"},
            content=b"",
            timeout=httpx.Timeout(60.0, connect=5.0),
        )
    except httpx.HTTPError as e:
        log.error("settle_bets_http_error", url=url, err=str(e))
        raise
    if resp.status_code != 200:
        log.error(
            "settle_bets_non_200",
            url=url,
            status=resp.status_code,
            body=resp.text[:300],
        )
        resp.raise_for_status()
    payload = resp.json()
    races = int(payload.get("races", 0) or 0)
    settled = int(payload.get("bets_settled", 0) or 0)
    void = int(payload.get("bets_void", 0) or 0)
    voided_races = payload.get("voided_races") or []
    log.info("settle_bets_done", races=races, bets_settled=settled, bets_void=void)

    # VOID 발생 시 Telegram 알림 — 운영자가 odds 누락 race 즉시 인지하도록.
    # 정산은 race 당 1회만 카운트되므로(race_settlements PK 가드) 중복 알림 없음.
    if void > 0 and voided_races:
        from crawler_core.client import notify_telegram

        lines = [
            f"- {v.get('race_date')} {v.get('meet')} {v.get('race_no')}R · {v.get('bets_void')}건"
            for v in voided_races[:10]
        ]
        more = "" if len(voided_races) <= 10 else f"\n... 외 {len(voided_races) - 10}건"
        notify_telegram(
            "모의배팅 정산 VOID",
            f"odds 누락으로 환급 처리:\n" + "\n".join(lines) + more,
        )

    return settled + void


@track_job("mal.audit_combo_dividends")
def run_audit_combo_dividends() -> int:
    """복식 배당 누락 자가진단 — 어제 결과 확정 race 중 race_combo_dividends 0건 탐지.

    `run_settle_bets` 가 odds 누락을 발견했을 때는 이미 VOID 환급이 발생한 뒤다.
    이 잡은 그 *전*에 데이터 무결성 결함을 찾아 운영자에게 알린다.

    반환: 누락 race 개수 (대시보드 rows_upserted 표시용).
    """
    from sqlalchemy import text

    from ..db import session_scope

    sql = text(
        """
        WITH finished AS (
          SELECT DISTINCT r.race_date, r.meet, r.race_no
            FROM races r
            JOIN race_results rr USING (race_date, meet, race_no)
           WHERE r.race_date = ((NOW() AT TIME ZONE 'Asia/Seoul')::date - 1)
             AND rr.rank IS NOT NULL
        )
        SELECT f.race_date, f.meet, f.race_no
          FROM finished f
          LEFT JOIN race_combo_dividends c USING (race_date, meet, race_no)
         GROUP BY f.race_date, f.meet, f.race_no
        HAVING COUNT(c.*) = 0
         ORDER BY f.meet, f.race_no
        """
    )
    with session_scope() as session:
        rows = session.execute(sql).all()

    missing = len(rows)
    log.info("audit_combo_dividends_done", missing_races=missing)

    if missing > 0:
        from crawler_core.client import notify_telegram

        lines = [
            f"- {r.race_date} {r.meet} {r.race_no}R" for r in rows[:10]
        ]
        more = "" if missing <= 10 else f"\n... 외 {missing - 10}건"
        notify_telegram(
            "모의배팅 배당 누락 감지",
            "어제 결과 확정 race 중 race_combo_dividends 0건:\n"
            + "\n".join(lines)
            + more,
        )

    return missing


@track_job("mal.build_favorite_notifications")
def run_build_favorite_notifications() -> int:
    """즐겨찾기 마필이 다음 경기 출주 확정되면 인앱 알림(notifications) 1건 INSERT.

    매칭 소스는 `race_entries` (출주표) — sync_race_entries(3시간 주기) 가
    새 entries 를 적재하면 본 잡이 1시간 이내로 알림을 만든다. dedup_key 로
    같은 (user, race) 조합은 두 번 INSERT 되지 않음.
    """
    return build_favorite_notifications()
