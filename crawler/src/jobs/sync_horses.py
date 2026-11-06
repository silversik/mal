"""Sync horses from KRA API42_1 into `horses` table using UPSERT.

not-found 원장 (backfill_missing_raw)
-------------------------------------
KRA 가 not-found(빈 응답·resultCode 03)를 주는 마필은 raw 가 영원히 NULL 이라 매
실행마다 재조회돼 쿼터만 태웠다. 그래서 `mal.sync_meta(source='horses_backfill_not_found')
.raw` 에 `{"attempts": {"<horse_no>": {"n", "last", "reason"}}}` 로 not-found 횟수를
기록하고 `NOT_FOUND_MAX_ATTEMPTS` (3) 회 이상이면 건너뛴다 (DB 라 재시작에도 영속,
chunked_backfill_dividends 와 같은 패턴 — 마이그레이션 불필요).
오류(타임아웃·5xx·쿼터)는 장애로 보고 횟수에 넣지 않는다. raw 가 다른 경로로 채워진
마필은 원장에서 자동 정리. 재시도를 강제하려면 해당 sync_meta row 를 지우면 된다.

실패 정책: 시도한 마필이 전부 오류(예외)면 RuntimeError — 조용한 0건 success 방지.
일부 실패는 경고, 대상 0건·not-found 만 있는 0건은 정상. 쿼터 초과 시 즉시 중단.
"""
from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.horse_detail import HorseDetailClient, api_item_to_horse_fields
from ..clients.kra_base import KraApiError, is_quota_error
from ..db import session_scope
from ..logging import get_logger
from ..models import Horse, SyncMeta

log = get_logger(__name__)

KST = ZoneInfo("Asia/Seoul")
NOT_FOUND_LEDGER_SOURCE = "horses_backfill_not_found"
# not-found 가 이 횟수에 닿으면 exhausted — 더 이상 호출하지 않음.
NOT_FOUND_MAX_ATTEMPTS = 3
# 경주결과 sync 안에서 붙는 enrich 1회 상한 (live 30분 틱마다 돌므로 작게).
INLINE_BACKFILL_LIMIT = 50
# data.go.kr resultCode 03 = NODATA_ERROR
_NODATA_CODES = {"03"}

FetchOutcome = Literal["ok", "not_found", "quota", "error"]


def upsert_horses(items: list[dict[str, Any]]) -> int:
    """UPSERT a batch of API items. Returns inserted+updated row count."""
    rows = [api_item_to_horse_fields(it) for it in items]
    rows = [r for r in rows if r["horse_no"] and r["horse_name"]]
    if not rows:
        return 0

    stmt = pg_insert(Horse).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[Horse.horse_no],
        set_={
            "horse_name": stmt.excluded.horse_name,
            "country": stmt.excluded.country,
            "sex": stmt.excluded.sex,
            "birth_date": stmt.excluded.birth_date,
            "sire_name": stmt.excluded.sire_name,
            "sire_no": stmt.excluded.sire_no,
            "dam_name": stmt.excluded.dam_name,
            "dam_no": stmt.excluded.dam_no,
            "total_race_count": stmt.excluded.total_race_count,
            "first_place_count": stmt.excluded.first_place_count,
            "coat_color": stmt.excluded.coat_color,
            "characteristics": stmt.excluded.characteristics,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
        },
    )

    with session_scope() as s:
        s.execute(stmt)

    log.info("horses_upserted", count=len(rows))
    return len(rows)


def sync_by_name(horse_name: str, *, meet: int | None = None) -> int:
    """Fetch horses matching `horse_name` from KRA and upsert."""
    with HorseDetailClient() as client:
        items = client.search_by_name(horse_name, meet=meet)
    log.info("horses_fetched", name=horse_name, meet=meet, count=len(items))
    return upsert_horses(items)


def sync_by_no(horse_no: str, *, meet: int | None = None) -> int:
    with HorseDetailClient() as client:
        item = client.get_by_no(horse_no, meet=meet)
    if not item:
        log.warning("horse_not_found", horse_no=horse_no)
        return 0
    return upsert_horses([item])


def _fetch_one(
    client: HorseDetailClient, hr_no: str
) -> tuple[FetchOutcome, dict[str, Any] | None, str | None]:
    """단건 조회 결과 분류: ok / not_found(빈 응답·NODATA) / quota / error(장애)."""
    try:
        item = client.get_by_no(hr_no)
    except Exception as e:  # noqa: BLE001 — 분류 후 호출부가 집계/실패 처리
        if is_quota_error(e):
            return "quota", None, str(e)
        if isinstance(e, KraApiError) and e.code in _NODATA_CODES:
            return "not_found", None, f"nodata_{e.code}"
        return "error", None, str(e)
    if not item:
        return "not_found", None, "empty"
    return "ok", item, None


def _raise_if_all_failed(
    job: str, *, attempted: int, errors: int, failed: list[str], quota_hit: bool
) -> None:
    """시도한 단위가 전부 예외면 RuntimeError, 일부면 경고."""
    if errors == 0:
        return
    if errors >= attempted:
        raise RuntimeError(
            f"{job}: 시도한 {attempted}건 전부 실패 (quota_hit={quota_hit}) — "
            f"{', '.join(failed[:20])}"
        )
    log.warning(
        f"{job}_partial_failure",
        attempted=attempted, errors=errors, quota_hit=quota_hit, failed=failed[:20],
    )


def _select_missing_raw() -> list[str]:
    """`raw` 가 SQL NULL 이거나 JSONB null 리터럴인 마필 전부 (horse_no 순)."""
    missing = or_(Horse.raw.is_(None), text("jsonb_typeof(raw) <> 'object'"))
    with session_scope() as s:
        stmt = select(Horse.horse_no).where(missing).order_by(Horse.horse_no)
        return list(s.execute(stmt).scalars())


def _load_not_found_ledger() -> dict[str, dict[str, Any]]:
    """sync_meta 원장 읽기. 형식이 다르면 빈 원장."""
    with session_scope() as s:
        row = s.get(SyncMeta, NOT_FOUND_LEDGER_SOURCE)
        raw = row.raw if row else None
    attempts = raw.get("attempts") if isinstance(raw, dict) else None
    if not isinstance(attempts, dict):
        return {}
    return {str(k): dict(v) for k, v in attempts.items() if isinstance(v, dict)}


def _save_not_found_ledger(attempts: dict[str, dict[str, Any]]) -> None:
    now = datetime.now(UTC)
    payload = {"attempts": attempts, "updated_at": now.isoformat()}
    stmt = pg_insert(SyncMeta).values(
        source=NOT_FOUND_LEDGER_SOURCE, raw=payload, last_run_at=now
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[SyncMeta.source],
        set_={"raw": payload, "last_run_at": now},
    )
    with session_scope() as s:
        s.execute(stmt)


def _attempt_count(entry: dict[str, Any] | None) -> int:
    try:
        return int((entry or {}).get("n", 0))
    except (TypeError, ValueError):
        return 0


def backfill_missing_raw(
    limit: int | None = None,
    sleep_sec: float = 0.15,
    max_not_found: int = NOT_FOUND_MAX_ATTEMPTS,
) -> int:
    """`raw` 가 비어있는 마필을 API42_1 으로 재조회해 UPSERT.

    최초 시드(경주결과에서 side-effect 로 생성된 horses row) 들은 raw/모색/특징이
    NULL 이므로, 이 함수로 메꾼다. 호출 간 `sleep_sec` 간격으로 API rate-limit 보호.
    `limit` 는 exhausted 를 뺀 대상 기준 (None = 전부 — 06:30 잡·CLI 백필용).
    not-found 원장·실패 정책은 모듈 docstring 참고.
    """
    all_missing = _select_missing_raw()
    stored = _load_not_found_ledger()
    missing_set = set(all_missing)
    # raw 가 채워진 마필은 원장에서 정리 → row 크기 bounded
    ledger = {k: v for k, v in stored.items() if k in missing_set}
    dirty = len(ledger) != len(stored)

    exhausted = [h for h in all_missing if _attempt_count(ledger.get(h)) >= max_not_found]
    pending = [h for h in all_missing if _attempt_count(ledger.get(h)) < max_not_found]
    if limit:
        pending = pending[:limit]
    if exhausted:
        log.warning(
            "backfill_not_found_exhausted_skipped",
            count=len(exhausted), max_attempts=max_not_found, horses=exhausted[:50],
        )

    if not pending:
        if dirty:
            _save_not_found_ledger(ledger)
        log.info("backfill_nothing_to_do", exhausted=len(exhausted))
        return 0

    today = datetime.now(KST).date().isoformat()
    log.info("backfill_start", pending=len(pending), exhausted=len(exhausted))
    count = 0
    attempted = 0
    errors = 0
    not_found = 0
    quota_hit = False
    failed: list[str] = []
    newly_exhausted: list[str] = []

    def _strike(hr_no: str, reason: str) -> None:
        nonlocal not_found, dirty
        not_found += 1
        n = _attempt_count(ledger.get(hr_no)) + 1
        ledger[hr_no] = {"n": n, "last": today, "reason": reason}
        dirty = True
        if n >= max_not_found:
            newly_exhausted.append(hr_no)
        log.warning("backfill_horse_not_found", horse_no=hr_no, reason=reason, attempt=n)

    try:
        with HorseDetailClient() as client:
            for idx, hr_no in enumerate(pending, 1):
                attempted += 1
                outcome, item, err = _fetch_one(client, hr_no)
                if outcome == "quota":
                    errors += 1
                    quota_hit = True
                    failed.append(hr_no)
                    log.warning("backfill_quota_hit", horse_no=hr_no, done=idx, err=err)
                    break
                if outcome == "error":
                    # 장애는 not-found 횟수에 넣지 않음 — 원장에 있던 마필만 최근 오류 메모
                    errors += 1
                    failed.append(hr_no)
                    if hr_no in ledger:
                        ledger[hr_no] = {**ledger[hr_no], "last_error": f"{today} {err}"[:200]}
                        dirty = True
                    log.warning("backfill_fetch_failed", horse_no=hr_no, err=err)
                    continue
                if outcome == "not_found":
                    _strike(hr_no, err or "empty")
                else:
                    n = upsert_horses([item])  # type: ignore[list-item]
                    if n:
                        count += n
                        if ledger.pop(hr_no, None) is not None:
                            dirty = True
                    else:
                        # 응답은 왔지만 마번/마명 누락으로 upsert 불가 → raw 계속 NULL
                        _strike(hr_no, "unmappable")
                if idx % 25 == 0:
                    log.info("backfill_progress", done=idx, total=len(pending))
                if sleep_sec:
                    time.sleep(sleep_sec)
    finally:
        if dirty:
            try:
                _save_not_found_ledger(ledger)
            except Exception as e:  # noqa: BLE001 — 원장 저장 실패가 잡 결과를 가리면 안 됨
                log.warning("backfill_ledger_save_failed", err=str(e))

    if newly_exhausted:
        log.warning(
            "backfill_not_found_newly_exhausted",
            count=len(newly_exhausted), max_attempts=max_not_found, horses=newly_exhausted,
        )
    log.info(
        "backfill_done",
        upserted=count, attempted=attempted, not_found=not_found,
        errors=errors, quota_hit=quota_hit, total=len(pending),
    )
    _raise_if_all_failed(
        "backfill_missing_raw",
        attempted=attempted, errors=errors, failed=failed, quota_hit=quota_hit,
    )
    return count


def refresh_stale_horses(
    older_than_days: int = 30,
    batch: int = 300,
    sleep_sec: float = 0.15,
) -> int:
    """`updated_at` 이 N 일 넘은 horses 를 batch 만큼 재조회해 통산성적 갱신.

    `backfill_missing_raw` 는 `raw IS NULL` 만 대상이라 한번 채운 뒤엔 영구 고정 →
    은퇴/장기미출전 마필의 `total_race_count`, `first_place_count` 가 누적 안 됨.
    이 함수가 주기적으로 (매일 batch 만큼) 순환시켜 메꾼다.
    시도한 마필이 전부 오류면 RuntimeError (not-found 는 오류 아님), 쿼터 초과 시 즉시 중단.
    """
    cutoff = datetime.now(UTC) - timedelta(days=older_than_days)
    with session_scope() as s:
        stmt = (
            select(Horse.horse_no)
            .where(Horse.updated_at < cutoff)
            .order_by(Horse.updated_at)
            .limit(batch)
        )
        horse_nos = list(s.execute(stmt).scalars())

    if not horse_nos:
        log.info("refresh_stale_nothing_to_do", cutoff_days=older_than_days)
        return 0

    log.info(
        "refresh_stale_start", batch_size=len(horse_nos), cutoff_days=older_than_days
    )
    count = 0
    attempted = 0
    errors = 0
    quota_hit = False
    failed: list[str] = []
    with HorseDetailClient() as client:
        for idx, hr_no in enumerate(horse_nos, 1):
            attempted += 1
            outcome, item, err = _fetch_one(client, hr_no)
            if outcome in ("quota", "error"):
                errors += 1
                failed.append(hr_no)
                if outcome == "quota":
                    quota_hit = True
                    log.warning("refresh_stale_quota_hit", horse_no=hr_no, done=idx, err=err)
                    break
                log.warning("refresh_stale_fetch_failed", horse_no=hr_no, err=err)
                continue
            if outcome == "not_found":
                log.warning("refresh_stale_horse_not_found", horse_no=hr_no, reason=err)
                continue
            count += upsert_horses([item])  # type: ignore[list-item]
            if idx % 50 == 0:
                log.info("refresh_stale_progress", done=idx, total=len(horse_nos))
            if sleep_sec:
                time.sleep(sleep_sec)
    log.info(
        "refresh_stale_done",
        upserted=count, attempted=attempted, errors=errors,
        quota_hit=quota_hit, batch_size=len(horse_nos),
    )
    _raise_if_all_failed(
        "refresh_stale_horses",
        attempted=attempted, errors=errors, failed=failed, quota_hit=quota_hit,
    )
    return count
