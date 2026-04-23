"""Nightly chunked backfill — race_dividends, reverse chronological, quota-aware.

운영 배경
---------
API301(`Dividend_rate_total`) 한 번 호출이 (date, meet) 단위로 ~30~65 페이지를 burn 한다.
일일 쿼터 1000회 기준으로 한 번에 ~15 (date, meet) 까지만 안전. `backfill_dividends`
원샷은 daily quota 를 너머서 silently 끊겼던 사례가 있어 (2026-04-23 09:11 ~16개 day 만
적재 후 종료), 야간 청크 잡으로 분할.

Cursor: `races` 테이블에 존재하는 (race_date, meet) 조합을 역시간 순회. cursor 는
`mal.sync_meta.source='chunked_backfill_dividends'` 의 `raw->>next_date` 에 보관 —
다음 야간 실행 시 그 시점부터 이어 진행. 429 발생 시 즉시 cursor 저장 후 종료.

`max_calls` 단위는 **sync_date 호출 수** (=실제 API page 호출의 ~30~60배). 기본 15 →
실제 ~450~900 API call → 일일 1000 쿼터 안.

수동 실행:
    uv run python -m src.jobs.chunked_backfill_dividends
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import distinct, exists, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..db import session_scope
from ..logging import get_logger
from ..models import Race, RaceDividend

log = get_logger(__name__)

# A1 backfill 범위: 6개월. 그 이전은 별도 정책 (현재 미진행).
LOOKBACK_DAYS_DEFAULT = 186
MAX_CALLS_DEFAULT = 15  # sync_date invocations — 각 ~30-60 page calls
SOURCE_KEY = "chunked_backfill_dividends"

_MEET_CODE = {"서울": 1, "제주": 2, "부경": 3}


def _load_state() -> dict[str, Any]:
    """sync_meta 에서 state 읽기. 최초 실행이면 today 부터 시작."""
    from ..models import SyncMeta

    with session_scope() as s:
        row = s.execute(
            select(SyncMeta).where(SyncMeta.source == SOURCE_KEY)
        ).scalar_one_or_none()
        if not row or not row.raw:
            return {"next_date": date.today().isoformat()}
        return dict(row.raw)


def _save_state(next_date: date) -> None:
    from ..models import SyncMeta

    payload = {
        "next_date": next_date.isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    now = datetime.now(timezone.utc)
    stmt = pg_insert(SyncMeta).values(
        source=SOURCE_KEY, raw=payload, last_run_at=now, last_success_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[SyncMeta.source],
        set_={"raw": payload, "last_run_at": now, "last_success_at": now},
    )
    with session_scope() as s:
        s.execute(stmt)


def _has_dividend(d: date, meet_name: str) -> bool:
    """이미 (date, meet) 의 race_dividends 가 있으면 skip."""
    with session_scope() as s:
        return bool(
            s.execute(
                select(
                    exists().where(
                        RaceDividend.race_date == d,
                        RaceDividend.meet == meet_name,
                    )
                )
            ).scalar()
        )


def _race_combos_in_window(
    upper: date, lower: date,
) -> list[tuple[date, str]]:
    """`races` 테이블에서 [lower, upper] 의 (date, meet_name) 조합을 역순 반환."""
    with session_scope() as s:
        rows = s.execute(
            select(distinct(Race.race_date), Race.meet)
            .where(Race.race_date >= lower, Race.race_date <= upper)
            .order_by(Race.race_date.desc())
        ).all()
    return [(d, m) for d, m in rows]


def run_chunk(
    max_calls: int = MAX_CALLS_DEFAULT,
    lookback_days: int = LOOKBACK_DAYS_DEFAULT,
) -> dict[str, Any]:
    """One nightly chunk. Returns summary dict."""
    from .sync_race_dividends import sync_date

    state = _load_state()
    cursor = datetime.strptime(state["next_date"], "%Y-%m-%d").date()
    floor = date.today() - timedelta(days=lookback_days)

    log.info(
        "chunked_dividends_start",
        cursor=str(cursor),
        floor=str(floor),
        budget=max_calls,
    )

    calls = 0
    added = 0
    skipped_existing = 0
    errors = 0
    quota_hit = False
    last_processed = cursor

    try:
        combos = _race_combos_in_window(upper=cursor, lower=floor)
        for d, meet_name in combos:
            if calls >= max_calls:
                break
            meet_code = _MEET_CODE.get(meet_name)
            if meet_code is None:
                continue
            if _has_dividend(d, meet_name):
                skipped_existing += 1
                continue
            try:
                n = sync_date(d, meet=meet_code)
                calls += 1
                added += n
                last_processed = d
            except Exception as exc:  # noqa: BLE001
                errmsg = str(exc)
                errors += 1
                calls += 1
                log.warning(
                    "chunked_dividends_failed",
                    date=str(d), meet=meet_name, err=errmsg,
                )
                if "429" in errmsg or "quota exceeded" in errmsg.lower():
                    quota_hit = True
                    log.info(
                        "chunked_dividends_quota_hit",
                        cursor=str(d), meet=meet_name, calls=calls,
                    )
                    last_processed = d
                    break
    finally:
        # 다음 cursor: quota_hit 면 현재 날짜(재시도) — d 까지는 처리 시도했으므로
        # last_processed - 1 day 를 cursor 로 두면 같은 날 재처리 안됨.
        # 정상 진행이면 마지막 처리한 날짜 그대로 (다음 실행 때 _has_dividend 가 skip).
        next_cursor = last_processed if quota_hit else last_processed - timedelta(days=1)
        if next_cursor < floor:
            next_cursor = floor  # 윈도우 바닥에 도달 — 다음 실행 시 0건 처리 후 동일 cursor
        _save_state(next_cursor)

    summary = {
        "cursor": last_processed.isoformat(),
        "next_cursor": (last_processed if quota_hit else last_processed - timedelta(days=1)).isoformat(),
        "calls": calls,
        "added_rows": added,
        "skipped_existing": skipped_existing,
        "errors": errors,
        "quota_hit": quota_hit,
        "done": last_processed <= floor and not quota_hit,
    }
    log.info("chunked_dividends_end", **summary)
    return summary


def main() -> None:
    budget = int(os.environ.get("CHUNKED_DIVIDENDS_BUDGET", MAX_CALLS_DEFAULT))
    lookback = int(os.environ.get("CHUNKED_DIVIDENDS_LOOKBACK_DAYS", LOOKBACK_DAYS_DEFAULT))
    s = run_chunk(max_calls=budget, lookback_days=lookback)
    print(
        f"cursor={s['cursor']} next={s['next_cursor']} calls={s['calls']} "
        f"added={s['added_rows']} skipped_existing={s['skipped_existing']} "
        f"errors={s['errors']} quota_hit={s['quota_hit']} done={s['done']}"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
