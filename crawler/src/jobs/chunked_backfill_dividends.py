"""Nightly gap backfill — race_combo_dividends 누락 (date, meet) 만 채움, quota-aware.

운영 배경
---------
API301(`Dividend_rate_total`) 한 번 호출이 (date, meet) 단위로 ~30~65 페이지를 burn 한다.
일일 쿼터 1000회 기준으로 한 번에 ~15 (date, meet) 까지만 안전. `backfill_dividends`
원샷은 daily quota 를 너머서 silently 끊겼던 사례가 있어 (2026-04-23 09:11 ~16개 day 만
적재 후 종료), 야간 청크 잡으로 분할.

Gap 기반 (stateless)
--------------------
예전엔 `mal.sync_meta(source='chunked_backfill_dividends')` 에 역방향 cursor 를 저장했는데,
바닥(`today - lookback`)은 매일 앞으로 오고 cursor 는 뒤로만 가서 둘이 만난 뒤로
(~2026-08) 매일 0건 success 만 기록했다. 그 사이 22:45 배당 잡이 실패한 날은 영영 미보정.

지금은 매 실행마다 DB 에서 직접 gap 을 계산한다:
  - `race_results` 에 확정 결과(rank 존재)가 있는 (race_date, meet) 중
  - `race_combo_dividends` 가 한 건도 없는 조합 (= 017 이후 fetch 안 된 조합)
  - 윈도우: [KST 오늘 - lookback_days, KST 어제], 최신순.
cursor 없음 — 남은 sync_meta row 는 더 이상 읽거나 쓰지 않는다 (있어도 무해).
race_results 는 읽기만 (immutable).

`max_calls` 단위는 **sync_date 호출 수** (=실제 API page 호출의 ~30~60배). 기본 15 →
실제 ~450~900 API call → 일일 1000 쿼터 안. 429/quota 감지 시 즉시 중단.

실패 정책: gap 이 있었는데 시도한 호출이 전부 (quota 외) 실패하면 RuntimeError →
@track_job 이 failure 로 기록. gap 0 은 정상 success(0).

수동 실행:
    uv run python -m src.jobs.chunked_backfill_dividends
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import exists, select

from ..db import session_scope
from ..logging import get_logger
from ..models import RaceComboDividend, RaceResult

log = get_logger(__name__)

# gap 탐색 윈도우 (KST 오늘 기준 과거 N일).
LOOKBACK_DAYS_DEFAULT = 365
MAX_CALLS_DEFAULT = 15  # sync_date invocations — 각 ~30-60 page calls

KST = ZoneInfo("Asia/Seoul")

_MEET_CODE = {"서울": 1, "제주": 2, "부경": 3}


def _kst_today() -> date:
    return datetime.now(KST).date()


def _is_quota_error(errmsg: str) -> bool:
    return "429" in errmsg or "quota exceeded" in errmsg.lower()


def _find_gaps(lower: date, upper: date) -> list[tuple[date, str]]:
    """[lower, upper] 에서 결과는 있는데 combo 배당이 없는 (date, meet) — 최신순.

    combo 존재 = "이 (date, meet) 는 017 마이그레이션 이후 fetch 됨" 의 정확한 마커
    (sync_date 한 번이 horse-level + combo 를 동시 upsert). horse-level
    (race_dividends) 만 보면 pre-017 적재분이 skip 되어 combo 가 영원히 빈다.
    """
    combo_exists = exists().where(
        RaceComboDividend.race_date == RaceResult.race_date,
        RaceComboDividend.meet == RaceResult.meet,
    )
    stmt = (
        select(RaceResult.race_date, RaceResult.meet)
        .distinct()
        .where(
            RaceResult.race_date >= lower,
            RaceResult.race_date <= upper,
            RaceResult.meet.in_(list(_MEET_CODE)),
            RaceResult.rank.is_not(None),  # 확정 결과만
            ~combo_exists,
        )
        .order_by(RaceResult.race_date.desc(), RaceResult.meet)
    )
    with session_scope() as s:
        rows = s.execute(stmt).all()
    # 같은 날짜 안에선 meet 코드 순 (서울→제주→부경) 으로 고정
    rows.sort(key=lambda r: (-r[0].toordinal(), _MEET_CODE[r[1]]))
    return [(d, m) for d, m in rows]


def run_chunk(
    max_calls: int = MAX_CALLS_DEFAULT,
    lookback_days: int = LOOKBACK_DAYS_DEFAULT,
) -> dict[str, Any]:
    """One nightly chunk. Returns summary dict.

    Raises RuntimeError: gap 이 있었고 시도한 sync_date 가 (quota 외) 전부 실패.
    """
    from .sync_race_dividends import sync_date

    today = _kst_today()
    upper = today - timedelta(days=1)  # 오늘분은 22:45 배당 잡 담당
    lower = today - timedelta(days=lookback_days)

    gaps = _find_gaps(lower=lower, upper=upper)
    log.info(
        "chunked_dividends_start",
        window_from=str(lower),
        window_to=str(upper),
        gaps_found=len(gaps),
        budget=max_calls,
    )
    if not gaps:
        log.info("chunked_dividends_no_gaps", window_from=str(lower), window_to=str(upper))

    calls = 0
    succeeded = 0
    empty = 0  # 호출은 성공했지만 KRA 응답 0건
    added = 0
    errors = 0
    quota_hit = False
    processed: list[str] = []
    failed: list[str] = []

    for d, meet_name in gaps:
        if calls >= max_calls:
            break
        calls += 1
        tag = f"{d.isoformat()}:{meet_name}"
        try:
            n = sync_date(d, meet=_MEET_CODE[meet_name])
        except Exception as exc:  # noqa: BLE001
            errmsg = str(exc)
            if _is_quota_error(errmsg):
                quota_hit = True
                log.info(
                    "chunked_dividends_quota_hit",
                    date=str(d), meet=meet_name, calls=calls,
                )
                break
            errors += 1
            failed.append(tag)
            log.warning(
                "chunked_dividends_failed",
                date=str(d), meet=meet_name, err=errmsg,
            )
            continue
        succeeded += 1
        added += n
        processed.append(tag)
        if n == 0:
            empty += 1
            log.warning("chunked_dividends_empty", date=str(d), meet=meet_name)

    summary = {
        "window_from": lower.isoformat(),
        "window_to": upper.isoformat(),
        "gaps_found": len(gaps),
        "calls": calls,
        "succeeded": succeeded,
        "empty": empty,
        "added_rows": added,
        "errors": errors,
        "quota_hit": quota_hit,
        # empty 응답은 combo 가 안 생겨 여전히 gap
        "remaining_gaps": len(gaps) - (succeeded - empty),
        "processed": processed,
        "failed": failed,
    }
    log.info("chunked_dividends_end", **summary)

    # 조용한 0건 success 방지 — 시도한 호출이 (quota 외) 전부 실패면 명시적 실패
    if errors > 0 and succeeded == 0:
        raise RuntimeError(
            f"chunked_dividends: gaps={len(gaps)} 중 시도한 {errors}건 전부 실패 "
            f"(quota_hit={quota_hit}) — {', '.join(failed)}"
        )
    return summary


def format_summary(s: dict[str, Any]) -> str:
    return (
        f"window={s['window_from']}..{s['window_to']} gaps={s['gaps_found']} "
        f"calls={s['calls']} ok={s['succeeded']} empty={s['empty']} "
        f"added={s['added_rows']} errors={s['errors']} quota_hit={s['quota_hit']} "
        f"remaining={s['remaining_gaps']}"
    )


def main() -> None:
    budget = int(os.environ.get("CHUNKED_DIVIDENDS_BUDGET", MAX_CALLS_DEFAULT))
    lookback = int(os.environ.get("CHUNKED_DIVIDENDS_LOOKBACK_DAYS", LOOKBACK_DAYS_DEFAULT))
    s = run_chunk(max_calls=budget, lookback_days=lookback)
    print(format_summary(s))
    sys.exit(0)


if __name__ == "__main__":
    main()
