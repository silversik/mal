"""Nightly chunked backfill — reverse chronological, quota-aware.

운영 배경: data.go.kr 일일 쿼터 제한으로 `backfill-history` 한 번에 4000+일을 돌리면 대부분
429 로 실패한다. 매일 자정(KST) 쿼터 리셋 직후 보수적 예산(기본 700 API calls)만 써서
조금씩 진행하는 야간 청크 잡.

Cursor: END → START 역방향. `mal.sync_meta` 의 source='chunked_backfill' 에 JSON 으로
다음 커서와 확정된 빈 셀(해당 date/meet 이 실제로 경주가 없는 날)을 저장해 재실행 시
이어받는다. sync_date 가 429 를 던지면 즉시 커서 저장 후 종료 → 다음 자정에 이어 진행.

수동 실행:
    uv run python -m src.jobs.chunked_backfill
"""
from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..db import session_scope
from ..logging import get_logger
from ..models import RaceResult

log = get_logger(__name__)

START_DATE = date(2015, 1, 1)
END_DATE = date(2026, 4, 22)
MAX_CALLS_DEFAULT = 700  # 스케줄러 일상 소모분 제외, 일일 1000 쿼터 기준 보수적
SOURCE_KEY = "chunked_backfill"


def _load_state() -> dict[str, Any]:
    """sync_meta 에서 chunked_backfill state 읽기. 최초 실행이면 END_DATE 부터 시작."""
    from ..models import SyncMeta  # lazy — 테스트 빌드 회피

    with session_scope() as s:
        row = s.execute(
            select(SyncMeta).where(SyncMeta.source == SOURCE_KEY)
        ).scalar_one_or_none()
        if not row or not row.raw:
            return {"next_date": END_DATE.isoformat(), "empty_cells": []}
        return dict(row.raw)


def _save_state(next_date: date, empty_cells: set[tuple[str, int]]) -> None:
    from ..models import SyncMeta

    payload = {
        "next_date": next_date.isoformat(),
        "empty_cells": sorted([[d, m] for d, m in empty_cells]),
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


def _has_data(d: date, meet: int) -> bool:
    """race_results 에 (date, meet) 로우가 하나라도 있으면 스킵 대상.

    `meet` 컬럼은 text/varchar — 숫자 비교가 아니라 문자열 비교로 붙여야 함.
    """
    with session_scope() as s:
        q = s.execute(
            select(
                exists().where(
                    RaceResult.race_date == d, RaceResult.meet == str(meet)
                )
            )
        )
        return bool(q.scalar())


def run_chunk(max_calls: int = MAX_CALLS_DEFAULT) -> dict[str, Any]:
    """One nightly chunk. Returns summary dict."""
    from .sync_races import sync_date  # lazy import to honor test isolation

    state = _load_state()
    cursor = datetime.strptime(state["next_date"], "%Y-%m-%d").date()
    empty_cells: set[tuple[str, int]] = {
        (d, int(m)) for d, m in (state.get("empty_cells") or [])
    }

    log.info(
        "chunked_backfill_start",
        cursor=str(cursor),
        budget=max_calls,
        empty_count=len(empty_cells),
    )

    calls = 0
    added = 0
    skipped_db = 0
    skipped_empty = 0
    errors = 0
    quota_hit = False

    try:
        while cursor >= START_DATE and calls < max_calls:
            dstr = cursor.isoformat()
            for meet in (1, 2, 3):
                if (dstr, meet) in empty_cells:
                    skipped_empty += 1
                    continue
                if _has_data(cursor, meet):
                    skipped_db += 1
                    continue
                try:
                    n = sync_date(cursor, meet=meet)
                    calls += 1
                    added += n
                    if n == 0:
                        empty_cells.add((dstr, meet))
                except Exception as e:  # noqa: BLE001
                    errmsg = str(e)
                    errors += 1
                    calls += 1
                    log.warning(
                        "chunked_day_failed", date=dstr, meet=meet, err=errmsg
                    )
                    if "429" in errmsg or "quota exceeded" in errmsg.lower():
                        quota_hit = True
                        log.info(
                            "chunked_backfill_quota_hit",
                            cursor=dstr,
                            meet=meet,
                            calls=calls,
                        )
                        # cursor 는 그대로(재시도) — state 저장 후 탈출
                        break
                if calls >= max_calls:
                    break
            if quota_hit:
                break
            cursor -= timedelta(days=1)
    finally:
        # cursor: 쿼터 히트면 현재 날짜(재시도), 아니면 cursor 는 이미 다음 미처리 날짜
        _save_state(cursor, empty_cells)

    summary = {
        "cursor": cursor.isoformat(),
        "calls": calls,
        "added_rows": added,
        "skipped_db": skipped_db,
        "skipped_empty": skipped_empty,
        "errors": errors,
        "quota_hit": quota_hit,
        "done": cursor < START_DATE,
    }
    log.info("chunked_backfill_end", **summary)
    return summary


def main() -> None:
    budget = int(os.environ.get("CHUNKED_BACKFILL_BUDGET", MAX_CALLS_DEFAULT))
    s = run_chunk(max_calls=budget)
    print(
        f"cursor={s['cursor']} calls={s['calls']} added={s['added_rows']} "
        f"skipped_db={s['skipped_db']} skipped_empty={s['skipped_empty']} "
        f"errors={s['errors']} quota_hit={s['quota_hit']} done={s['done']}"
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
