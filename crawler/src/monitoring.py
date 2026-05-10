"""Scraper run tracking + Telegram failure notifications.

Usage:
    @track_job("mal.sync_news")
    def sync_news() -> int:
        ...

이전 버전은 `scraper_runs` DB 테이블에 직접 row 를 insert/update 했지만,
통합 크롤러 대시보드 (crawler-dashboard) 로 HTTP 리포트하도록 변경됐다.
- 시작 시: `dashboard_client.start_run(job_key)` → run_id
- 종료 시: `dashboard_client.finish_run(run_id, status=..., rows=..., error=...)`

대시보드가 일시 불가해도 크롤러 자체는 그대로 동작하도록 start/finish 호출은
모두 예외 삼키도록 설계됨 (dashboard_client 내부 처리).

`@track_job` 는 최초 호출 시 `dashboard_client.register_job(...)` 로 스펙을
idempotent 하게 upsert 한다. job_key 는 전역 유니크 — 'mal.sync_news' 처럼
서비스 prefix 를 붙여서 사용 권장.

Telegram 실패 알림은 `crawler_core.client.safe_finish_run(job_key=...)` 내부에서
`maybe_notify_failure` 로 dedupe 처리. 이 모듈은 job_key 만 넘겨주면 됨.

check_stale 은 대시보드가 자체적으로 보여주므로 별도 로직은 제거.
"""
from __future__ import annotations

import time
import traceback
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from crawler_core import client as dash
from .logging import get_logger

log = get_logger(__name__)

P = ParamSpec("P")
R = TypeVar("R")


# ── JOB 메타 카탈로그 ──────────────────────────────────────────────────────────
# 여기 한 곳에서 선언하고 @track_job 에서 lookup. 컨테이너 기동 시 (또는 첫 호출 시)
# 대시보드에 idempotent upsert. mal 서비스 prefix 로 전역 유니크 키 구성.
# 추가 job 은 이 dict 에 한 줄만 넣고 periodic.py / main.py 에서 @track_job("mal.<name>") 사용.
JOB_CATALOG: dict[str, dict] = {
    "mal.sync_news": {
        "category": "naver_search",
        "description": "네이버 뉴스 검색 (경마/한국마사회/렛츠런파크)",
        "expected_interval_sec": 1800,  # 30min
    },
    "mal.sync_videos": {
        "category": "youtube",
        "description": "KRBC YouTube 최신 업로드",
        "expected_interval_sec": 3600,
    },
    "mal.sync_races_today": {
        "category": "kra_openapi",
        "description": "오늘 경주결과 (API4, 3개 경마장)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_races_live": {
        "category": "kra_openapi",
        "description": "경기일 실시간 결과+배당 갱신 (평일 10~21시 시간당 / 주말 10~22시 15분 간격)",
        "expected_interval_sec": 3600,
    },
    "mal.sync_yesterday_catchup": {
        "category": "kra_openapi",
        "description": "전날 경주결과·배당·매출 누락 보정 (07:30 KST)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_jockeys": {
        "category": "kra_openapi",
        "description": "기수 목록/성적",
        "expected_interval_sec": 86400,
    },
    "mal.sync_horses_backfill": {
        "category": "kra_openapi",
        "description": "raw NULL 인 horses 재조회",
        "expected_interval_sec": 86400,
    },
    "mal.sync_horses_refresh": {
        "category": "kra_openapi",
        "description": "updated_at > 30d stale horses 순환 재조회",
        "expected_interval_sec": 86400,
    },
    "mal.backfill_history": {
        "category": "kra_openapi",
        "description": "최근 33년 race_results + horses 일괄 부트스트랩 (수동 트리거)",
        "expected_interval_sec": 86400 * 365,  # 사실상 1회용 — stale 경고 방지용 큰 값
    },
    "mal.sync_race_plan": {
        "category": "kra_openapi",
        "description": "연간 대상경주 계획",
        "expected_interval_sec": 86400,
    },
    "mal.sync_race_entries": {
        "category": "kra_openapi",
        "description": "예정 경주 출전표",
        "expected_interval_sec": 14400,
    },
    "mal.sync_race_info": {
        "category": "kra_openapi",
        "description": "경주 메타(이름/거리/등급/주로/발주시각) API187 백필 — 05:30·22:30 KST 2회",
        # 05:30 ↔ 22:30 KST 두 번 실행: 가장 긴 간격 17시간(61200s) → 18h 여유로 클램프.
        "expected_interval_sec": 64800,
    },
    "mal.sync_race_today_meta": {
        "category": "kra_openapi",
        "description": "당일 발주시각·거리 HTML 크롤링 (race.kra.co.kr/seoulMain.do) — API187 빈 응답 fallback",
        # 06~21시 매시 정각 → 1시간 간격. 안전여유 2h 클램프.
        "expected_interval_sec": 7200,
    },
    "mal.sync_race_dividends": {
        "category": "kra_openapi",
        "description": "확정배당율 (API301/Dividend_rate_total)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_race_sales": {
        "category": "kra_openapi",
        "description": "경주별·풀별 매출액 (API179_1, 15119558)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_race_result_corners": {
        "category": "kra_openapi",
        "description": "경주 통과순위·구간기록 (API4_2/raceResult_2, 15089493) — 페이스 맵 의존",
        "expected_interval_sec": 86400,
    },
    "mal.sync_trainers": {
        "category": "kra_openapi",
        "description": "조교사정보_영문추가 (API308, 15130588)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_owners": {
        "category": "kra_openapi",
        "description": "마주정보_영문추가 (API309, 15130589)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_jockey_changes": {
        "category": "kra_openapi",
        "description": "기수변경 이벤트 (API10_1, 15057181)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_horse_rank_changes": {
        "category": "kra_openapi",
        "description": "경주마 등급변동 (raceHorseRatingChangeInfo_2, 15058076)",
        "expected_interval_sec": 86400,
    },
    "mal.sync_horse_ratings": {
        "category": "kra_openapi",
        "description": "경주마 레이팅 (15057323, recommendDataYn=Y)",
        "expected_interval_sec": 604800,  # weekly
    },
    "mal.chunked_dividends_backfill": {
        "category": "kra_openapi",
        "description": "확정배당율 야간 청크 백필 (6개월 윈도우, 일일 ~15 day×meet)",
        "expected_interval_sec": 86400,  # daily
    },
    "mal.sync_videos_backfill": {
        "category": "youtube",
        "description": "누락된 경주 영상 YouTube search 로 매칭",
        "expected_interval_sec": 86400,
    },
    "mal.settle_bets": {
        "category": "mock_betting",
        "description": "모의배팅 정산 — 결과 확정된 경주의 PENDING bets → /api/internal/settle",
        "expected_interval_sec": 600,  # 10min
    },
    "mal.audit_combo_dividends": {
        "category": "mock_betting",
        "description": "복식 배당 누락 자가진단 — 어제 결과 확정 race 중 race_combo_dividends 0건 탐지",
        "expected_interval_sec": 86400,  # daily
    },
    "mal.build_favorite_notifications": {
        "category": "notifications",
        "description": "즐겨찾기 마필 다음 경기 출주 → 인앱 알림 적재",
        "expected_interval_sec": 3600,  # hourly — sync_race_entries(3h) 보다 자주 회전
    },
}

_registered: set[str] = set()


def _ensure_registered(job_key: str) -> None:
    if job_key in _registered:
        return
    spec = JOB_CATALOG.get(job_key)
    if spec is None:
        log.warning("track_job_unknown_key", job_key=job_key)
        # catalog 누락이어도 실행은 계속 — 최소 스펙으로 등록
        spec = {"category": None, "description": None, "expected_interval_sec": 3600}
    dash.safe_register(
        job_key=job_key,
        service="mal",
        category=spec.get("category"),
        description=spec.get("description"),
        expected_interval_sec=int(spec.get("expected_interval_sec", 3600)),
    )
    _registered.add(job_key)


def track_job(job_key: str) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Wrap a sync function to report its run to the crawler dashboard.

    - 첫 호출 시 job_key 를 대시보드에 upsert (JOB_CATALOG 기반)
    - 함수 호출 전 start_run → run_id
    - 함수 반환값이 int 이면 rows_upserted 로 보고
    - 예외 시 status=failed + error_message 보고 후 re-raise + Telegram 알림
    """

    def decorator(fn: Callable[P, R]) -> Callable[P, R]:
        @wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            _ensure_registered(job_key)
            run_id = dash.safe_start_run(job_key)
            t0 = time.monotonic()
            try:
                result = fn(*args, **kwargs)
            except Exception as exc:
                err = f"{type(exc).__name__}: {exc}"
                tb = traceback.format_exc()
                # safe_finish_run(job_key=...) 가 내부적으로 Telegram 알림까지 dedupe 발화.
                dash.safe_finish_run(
                    run_id,
                    status="failed",
                    error_message=(err + "\n\n" + tb)[:4000],
                    job_key=job_key,
                )
                raise
            else:
                rows = result if isinstance(result, int) else None
                dash.safe_finish_run(run_id, status="success", rows_upserted=rows)
                return result

        return wrapper

    return decorator


def register_all_jobs() -> None:
    """컨테이너 기동 시 CLI 로 호출 가능 — JOB_CATALOG 전부 upsert.

    런타임에 @track_job 이 첫 호출에서 lazy 등록하므로 필수는 아니지만,
    대시보드 UI 에 cold-start 상태에서도 job 목록이 보이도록 미리 등록하는 용도.
    """
    for job_key in JOB_CATALOG.keys():
        _ensure_registered(job_key)


def check_stale(*, multiplier: float = 1.5) -> list[dict]:
    """통합 대시보드가 자체적으로 stale 판정/UI 표시하므로 여기서는 no-op."""
    log.info("check_stale_delegated_to_dashboard", multiplier=multiplier)
    return []
