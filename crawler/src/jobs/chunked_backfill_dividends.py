"""Nightly gap backfill — race_combo_dividends 누락 (date, meet) 만 채움, quota-aware.

운영 배경
---------
API301(`Dividend_rate_total`) 한 번 호출이 (date, meet) 단위로 ~30~65 페이지를 burn 한다.
일일 쿼터 1000회 기준으로 한 번에 ~15 (date, meet) 까지만 안전. 예전 원샷
`backfill_dividends`(제거됨)는 daily quota 를 너머서 silently 끊겼던 사례가 있어
(2026-04-23 09:11 ~16개 day 만 적재 후 종료), 야간 청크 잡으로 분할했다. 수동 범위
백필도 이 모듈의 `chunked-dividends-backfill --budget/--lookback-days` CLI 를 쓴다.

Gap 기반
--------
예전엔 `mal.sync_meta(source='chunked_backfill_dividends')` 에 역방향 cursor 를 저장했는데,
바닥(`today - lookback`)은 매일 앞으로 오고 cursor 는 뒤로만 가서 둘이 만난 뒤로
(~2026-08) 매일 0건 success 만 기록했다. 그 사이 22:45 배당 잡이 실패한 날은 영영 미보정.

지금은 매 실행마다 DB 에서 직접 gap 을 계산한다:
  - `race_results` 에 확정 결과(rank 존재)가 있는 (race_date, meet) 중
  - `race_combo_dividends` 가 한 건도 없는 조합 (= 017 이후 fetch 안 된 조합)
  - 윈도우: [KST 오늘 - lookback_days, KST 어제], 최신순.
cursor 는 없다. race_results 는 읽기만 (immutable).

시도 원장 (attempts ledger)
---------------------------
KRA 가 특정 (date, meet) 에 0건을 주거나 WIN/PLC 만 주고 combo 를 안 주면 그 gap 은
영구히 안 채워진다. 원장이 없으면 매일 최신순으로 같은 gap 만 재시도해 15회 예산을
전부 태우고 success 로 기록 — 고치려던 "조용히 멈춤" 상태가 재현된다.

그래서 호출은 성공했는데 combo 를 못 만든 시도(0건·WIN/PLC 만)를 센다. 오류(타임아웃·5xx·
키/IP 오류)는 장애로 보고 횟수에 넣지 않는다 (장애 며칠 = 그 장애가 만든 gap 영구 skip 방지).
이 원장을
`mal.sync_meta(source='chunked_backfill_dividends').raw` (옛 cursor 와 같은 row, DB 라
컨테이너 재시작에도 영속) 에 `{"attempts": {"YYYY-MM-DD:서울": {"n", "last", "reason"}}}`
로 기록한다. `MAX_ATTEMPTS_DEFAULT` (3) 회 실패한 gap 은 "exhausted" 로 보고 건너뛰고
경고 로그로 남긴다. gap 이 다른 경로로 채워졌거나 윈도우를 벗어나면 원장에서 자동 정리.
윈도우 안 gap 이 전부 exhausted 면 `chunked_dividends_all_exhausted` 경고 로그.
재시도를 강제하려면 해당 sync_meta row 를 지우면 된다.

`max_calls` 단위는 **sync_date 호출 수** (=실제 API page 호출의 ~30~60배). 기본 15 →
실제 ~450~900 API call → 일일 1000 쿼터 안. 429/quota 감지 시 즉시 중단.

실패 정책: gap 이 있었는데 시도한 호출이 전부 (quota 외) 실패하면 RuntimeError →
@track_job 이 failure 로 기록. gap 0 은 정상 success(0).
quota 판정: HTTP 429(상태코드) · "quota exceeded" · data.go.kr 레거시 코드 22
(`KRA API error 22` / LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR) → 즉시 중단,
원장에는 시도로 세지 않음.

수동 실행:
    uv run python -m src.jobs.chunked_backfill_dividends
"""
from __future__ import annotations

import os
import sys
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.kra_base import is_quota_error
from ..db import session_scope
from ..logging import get_logger
from ..models import RaceComboDividend, RaceResult, SyncMeta

log = get_logger(__name__)

# gap 탐색 윈도우 (KST 오늘 기준 과거 N일).
LOOKBACK_DAYS_DEFAULT = 365
MAX_CALLS_DEFAULT = 15  # sync_date invocations — 각 ~30-60 page calls
# combo 를 못 만든 시도가 이 횟수에 닿으면 exhausted — 더 이상 예산을 쓰지 않음.
MAX_ATTEMPTS_DEFAULT = 3
# 옛 cursor 와 같은 sync_meta row 를 원장 저장소로 재사용 (raw 를 통째로 교체).
SOURCE_KEY = "chunked_backfill_dividends"

KST = ZoneInfo("Asia/Seoul")

_MEET_CODE = {"서울": 1, "제주": 2, "부경": 3}


def _kst_today() -> date:
    return datetime.now(KST).date()


# 쿼터 판정은 kra_base 공용 (sync_horses 도 같은 규칙 사용)
_is_quota_error = is_quota_error


def _gap_key(d: date, meet_name: str) -> str:
    return f"{d.isoformat()}:{meet_name}"


def _load_attempts() -> dict[str, dict[str, Any]]:
    """sync_meta 원장 읽기. 옛 cursor payload(`next_date`) 등 형식이 다르면 빈 원장."""
    with session_scope() as s:
        row = s.get(SyncMeta, SOURCE_KEY)
        raw = row.raw if row else None
    attempts = raw.get("attempts") if isinstance(raw, dict) else None
    if not isinstance(attempts, dict):
        return {}
    return {k: dict(v) for k, v in attempts.items() if isinstance(v, dict)}


def _save_attempts(attempts: dict[str, dict[str, Any]]) -> None:
    now = datetime.now(UTC)
    payload = {"attempts": attempts, "updated_at": now.isoformat()}
    stmt = pg_insert(SyncMeta).values(source=SOURCE_KEY, raw=payload, last_run_at=now)
    stmt = stmt.on_conflict_do_update(
        index_elements=[SyncMeta.source],
        set_={"raw": payload, "last_run_at": now},
    )
    with session_scope() as s:
        s.execute(stmt)


def _has_combos(d: date, meet_name: str) -> bool:
    """(date, meet) 에 combo 배당이 한 건이라도 있나 — `_find_gaps` 와 같은 마커."""
    with session_scope() as s:
        return bool(
            s.execute(
                select(
                    exists().where(
                        RaceComboDividend.race_date == d,
                        RaceComboDividend.meet == meet_name,
                    )
                )
            ).scalar()
        )


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
    max_attempts: int = MAX_ATTEMPTS_DEFAULT,
) -> dict[str, Any]:
    """One nightly chunk. Returns summary dict.

    Raises RuntimeError: gap 이 있었고 시도한 sync_date 가 (quota 외) 전부 실패.
    """
    from .sync_race_dividends import sync_date

    today = _kst_today()
    upper = today - timedelta(days=1)  # 오늘분은 22:45 배당 잡 담당
    lower = today - timedelta(days=lookback_days)

    gaps = _find_gaps(lower=lower, upper=upper)
    gap_keys = {_gap_key(d, m) for d, m in gaps}
    # 채워졌거나 윈도우를 벗어난 gap 은 원장에서 정리 → row 크기 bounded
    attempts = {k: v for k, v in _load_attempts().items() if k in gap_keys}

    def _n(key: str) -> int:
        try:
            return int(attempts.get(key, {}).get("n", 0))
        except (TypeError, ValueError):
            return 0

    exhausted = [_gap_key(d, m) for d, m in gaps if _n(_gap_key(d, m)) >= max_attempts]
    pending = [(d, m) for d, m in gaps if _n(_gap_key(d, m)) < max_attempts]

    log.info(
        "chunked_dividends_start",
        window_from=str(lower),
        window_to=str(upper),
        gaps_found=len(gaps),
        pending=len(pending),
        exhausted=len(exhausted),
        budget=max_calls,
    )
    if not gaps:
        log.info("chunked_dividends_no_gaps", window_from=str(lower), window_to=str(upper))
    if exhausted:
        log.warning(
            "chunked_dividends_exhausted_skipped",
            count=len(exhausted),
            max_attempts=max_attempts,
            gaps=exhausted[:50],
        )
    if gaps and not pending:
        log.warning(
            "chunked_dividends_all_exhausted",
            gaps_found=len(gaps),
            max_attempts=max_attempts,
            hint=(
                "윈도우 안 gap 이 전부 재시도 한도 초과 — KRA 가 combo 를 주지 않는 조합. "
                "수동 확인 필요 (sync_meta source=chunked_backfill_dividends 삭제 시 재시도)"
            ),
        )

    calls = 0
    succeeded = 0  # sync_date 가 예외 없이 끝난 호출
    resolved = 0  # 호출 후 combo 가 실제로 생긴 gap
    empty = 0  # 호출은 성공했지만 여전히 combo 없음 (0건 또는 WIN/PLC 만)
    added = 0
    errors = 0
    quota_hit = False
    processed: list[str] = []
    failed: list[str] = []
    newly_exhausted: list[str] = []

    def _record_miss(key: str, reason: str) -> None:
        n = _n(key) + 1
        attempts[key] = {"n": n, "last": today.isoformat(), "reason": reason}
        if n >= max_attempts:
            newly_exhausted.append(key)

    try:
        for d, meet_name in pending:
            if calls >= max_calls:
                break
            calls += 1
            tag = _gap_key(d, meet_name)
            try:
                n = sync_date(d, meet=_MEET_CODE[meet_name])
            except Exception as exc:  # noqa: BLE001
                errmsg = str(exc)
                if _is_quota_error(exc):
                    quota_hit = True
                    log.info(
                        "chunked_dividends_quota_hit",
                        date=str(d), meet=meet_name, calls=calls, err=errmsg[:200],
                    )
                    break
                errors += 1
                failed.append(tag)
                # 오류(타임아웃·5xx·키/IP 오류 등)는 시도 횟수에 넣지 않는다 — KRA 장애가 며칠
                # 이어지면 바로 그 장애로 생긴 gap 들이 exhausted 로 영구 skip 되기 때문.
                # 최근 오류만 메모해 두고, exhausted 판정은 "호출 성공 + combo 없음" 만 센다.
                attempts[tag] = {
                    **attempts.get(tag, {}),
                    "n": _n(tag),
                    "last_error": f"{today.isoformat()} {errmsg[:200]}",
                }
                log.warning(
                    "chunked_dividends_failed",
                    date=str(d), meet=meet_name, err=errmsg,
                )
                continue
            succeeded += 1
            added += n
            processed.append(tag)
            # sync_date 반환값(WIN/PLC 포함 row 수)이 아니라 combo 실존 여부로 판정
            if _has_combos(d, meet_name):
                resolved += 1
                attempts.pop(tag, None)
            else:
                empty += 1
                _record_miss(tag, "no_combos" if n else "empty")
                log.warning(
                    "chunked_dividends_empty",
                    date=str(d), meet=meet_name, rows=n, attempt=_n(tag),
                )
    finally:
        try:
            _save_attempts(attempts)
        except Exception as exc:  # noqa: BLE001 — 원장 저장 실패가 잡 결과를 가리면 안 됨
            log.warning("chunked_dividends_ledger_save_failed", err=str(exc))

    if newly_exhausted:
        log.warning(
            "chunked_dividends_newly_exhausted",
            count=len(newly_exhausted),
            max_attempts=max_attempts,
            gaps=newly_exhausted,
        )

    summary = {
        "window_from": lower.isoformat(),
        "window_to": upper.isoformat(),
        "gaps_found": len(gaps),
        "pending": len(pending),
        "exhausted": len(exhausted) + len(newly_exhausted),
        "newly_exhausted": len(newly_exhausted),
        "calls": calls,
        "succeeded": succeeded,
        "resolved": resolved,
        "empty": empty,
        "added_rows": added,
        "errors": errors,
        "quota_hit": quota_hit,
        "remaining_gaps": len(gaps) - resolved,
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
        f"pending={s['pending']} exhausted={s['exhausted']} "
        f"calls={s['calls']} ok={s['succeeded']} resolved={s['resolved']} "
        f"empty={s['empty']} added={s['added_rows']} errors={s['errors']} "
        f"quota_hit={s['quota_hit']} remaining={s['remaining_gaps']}"
    )


def main() -> None:
    budget = int(os.environ.get("CHUNKED_DIVIDENDS_BUDGET", MAX_CALLS_DEFAULT))
    lookback = int(os.environ.get("CHUNKED_DIVIDENDS_LOOKBACK_DAYS", LOOKBACK_DAYS_DEFAULT))
    s = run_chunk(max_calls=budget, lookback_days=lookback)
    print(format_summary(s))
    sys.exit(0)


if __name__ == "__main__":
    main()
