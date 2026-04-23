"""1차 백필 — 최근 N개월 race_dividends 일괄 적재.

전략: `races` 테이블에 이미 있는 (race_date, meet) 조합을 역시간 순으로 순회.
이미 race_dividends 행이 존재하면 skip — 재실행 안전.

수동 실행:
    uv run python -m src.jobs.backfill_dividends --months 6 --sleep 0.3
"""
from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Iterable

from sqlalchemy import distinct, exists, select

from ..db import session_scope
from ..logging import get_logger
from ..models import Race, RaceDividend
from .sync_race_dividends import sync_date

log = get_logger(__name__)

_MEET_CODE = {"서울": 1, "제주": 2, "부경": 3}


def _race_days_in_window(start: date, end: date) -> Iterable[tuple[date, str]]:
    """`races` 테이블에서 [start, end] 범위의 (date, meet) 고유 조합을 역순으로."""
    with session_scope() as s:
        rows = s.execute(
            select(distinct(Race.race_date), Race.meet)
            .where(Race.race_date >= start, Race.race_date <= end)
            .order_by(Race.race_date.desc())
        ).all()
    for d, m in rows:
        yield d, m


def _has_dividend(d: date, meet_name: str) -> bool:
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


def backfill(months: int = 6, sleep_sec: float = 0.3) -> int:
    end = date.today()
    start = end - timedelta(days=months * 31)
    total = 0
    skipped = 0
    for d, meet_name in _race_days_in_window(start, end):
        meet_code = _MEET_CODE.get(meet_name)
        if meet_code is None:
            continue
        if _has_dividend(d, meet_name):
            skipped += 1
            continue
        try:
            n = sync_date(d, meet=meet_code)
        except Exception as exc:  # noqa: BLE001 — 잡 1건 실패는 다음 날짜 진행
            log.warning(
                "backfill_dividend_failed",
                date=str(d), meet=meet_name, err=str(exc),
            )
            continue
        total += n
        time.sleep(sleep_sec)
    log.info("backfill_dividends_done", upserted=total, skipped=skipped)
    return total


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--months", type=int, default=6)
    p.add_argument("--sleep", type=float, default=0.3)
    args = p.parse_args()
    n = backfill(months=args.months, sleep_sec=args.sleep)
    print(f"backfilled {n} race_dividend rows")
