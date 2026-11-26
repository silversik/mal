"""Sync 출전표 상세정보 → `race_entries` 테이블.

앞으로 며칠 안의 예정 경주 출전 마필 리스트를 미리 가져온다.
주기: 3시간이 기본 (대시보드에서 조정 가능).

경주일은 요일로 정하지 않는다 — 공휴일(예: 2026-10-05 월 대체공휴일 17경주)에도
경주가 열린다. KRA 에 시행일정 API 가 없으므로 출전표 API 자체로 판정한다:
출전표가 공표되는 범위(오늘~+ENTRY_PUBLISH_PROBE_DAYS)는 매일 조회하고,
그 너머는 기존처럼 금/토/일만 조회한다. 어떤 날짜의 3개 경마장 조회가 모두 실패하면
그날이 경주일인지 알 수 없으므로 잡을 실패시킨다 (조용한 0건 success 방지).
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from ..clients.race_chulma import RaceChulmaClient, api_item_to_race_entry_fields
from ..db import session_scope
from ..logging import get_logger
from ..meets import MEET_CODES
from ..models import Race, RaceEntry
from ..redact import redact
from ._failloud import UnitFailures, is_kra_no_data

log = get_logger(__name__)

KST = ZoneInfo("Asia/Seoul")
MEETS = MEET_CODES  # 서울·제주·부경·영천 — src/meets.py 단일 진실원
#: 정기 경주 요일 (금/토/일) — 출전표 공표 전 구간의 조회 대상.
WEEKEND_RACE_WEEKDAYS = (4, 5, 6)
#: 출전표는 경주일 ~3일 전 공표 — 오늘~+N일은 요일 무관 매일 조회 (공휴일 경주 대응).
ENTRY_PUBLISH_PROBE_DAYS = 4
# 한 경주에서 이 비율을 넘게 빠지면 출전취소가 아니라 응답 이상으로 보고 표시하지 않는다.
SCRATCH_MAX_DROP_PCT = 50


def upsert_race_entries(items: list[dict[str, Any]]) -> int:
    rows = [
        r for r in items
        if r.get("race_date") and r.get("race_no") is not None and r.get("horse_no")
    ]
    if not rows:
        return 0

    # Dedup in-batch to avoid CardinalityViolation.
    seen: set[tuple] = set()
    unique: list[dict[str, Any]] = []
    for r in rows:
        key = (str(r["race_date"]), r["meet"], r["race_no"], r["horse_no"])
        if key not in seen:
            seen.add(key)
            unique.append(r)

    stmt = pg_insert(RaceEntry).values(unique)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_race_entries",
        set_={
            "chul_no": stmt.excluded.chul_no,
            "horse_name": stmt.excluded.horse_name,
            "jk_no": stmt.excluded.jk_no,
            "jockey_name": stmt.excluded.jockey_name,
            "trainer_name": stmt.excluded.trainer_name,
            "weight": stmt.excluded.weight,
            "age": stmt.excluded.age,
            "sex": stmt.excluded.sex,
            "rating": stmt.excluded.rating,
            "raw": stmt.excluded.raw,
            "updated_at": func.now(),
            # 다시 출전표에 나타나면 출전취소 표시를 거둔다.
            "scratched_at": None,
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("race_entries_upserted", count=len(unique))
    return len(unique)


def upsert_races_skeleton(items: list[dict[str, Any]]) -> int:
    """출전표 items 로부터 (race_date, meet, race_no) 고유 키를 뽑아 `races` 에
    선(先) 행을 만든다. entry_count 만 채우고 나머지 메타(race_name/distance/
    grade)는 backfill_races_from_entries·sync_race_today_meta 가 채운다.

    기존 races 행이 이미 있으면 entry_count 만 COALESCE 로 채운다 — 결과가
    이미 들어온 레이스의 정확한 entry_count 를 덮어쓰지 않도록.
    """
    counts: dict[tuple[date, str, int], int] = {}
    for r in items:
        rd = r.get("race_date")
        mt = r.get("meet")
        rn = r.get("race_no")
        if not (rd and mt and rn is not None):
            continue
        counts[(rd, mt, rn)] = counts.get((rd, mt, rn), 0) + 1

    if not counts:
        return 0

    rows = [
        {"race_date": rd, "meet": mt, "race_no": rn, "entry_count": n}
        for (rd, mt, rn), n in counts.items()
    ]
    stmt = pg_insert(Race).values(rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_races",
        set_={
            # 기존 값 보존 — race_results 기반 정확 카운트를 덮어쓰지 않음.
            "entry_count": func.coalesce(Race.entry_count, stmt.excluded.entry_count),
        },
    )
    with session_scope() as s:
        s.execute(stmt)
    log.info("races_skeleton_upserted", count=len(rows))
    return len(rows)


def _upcoming_race_dates(
    base: date,
    days_ahead: int = 10,
    probe_days: int = ENTRY_PUBLISH_PROBE_DAYS,
) -> list[date]:
    """조회할 후보 경주일 — base~base+probe_days 는 매일, 그 뒤 base+days_ahead 까지는 금/토/일."""
    if days_ahead < 0 or probe_days < 0:
        raise ValueError(f"days_ahead={days_ahead}, probe_days={probe_days} 는 0 이상이어야 함")
    out: list[date] = []
    for i in range(days_ahead + 1):
        d = base + timedelta(days=i)
        if i <= probe_days or d.weekday() in WEEKEND_RACE_WEEKDAYS:
            out.append(d)
    return out


def scratch_candidates(
    active: Mapping[int, set[str]], fetched: Iterable[Mapping[str, Any]]
) -> set[tuple[int, str]]:
    """(date, meet) 재수집 응답에서 빠진 활성 출전마 = 출전취소 후보 (race_no, horse_no).

    active: 지금 DB 의 활성 행(scratched_at IS NULL) — race_no → horse_no 집합.
    가드 (응답 이상을 출전취소로 오인하지 않게):
      * 응답이 비면 아무것도 표시하지 않는다 (공표 전·KRA 일시 오류).
      * 응답에 아예 없는 경주는 건드리지 않는다 (페이징 누락 등).
      * 한 경주에서 SCRATCH_MAX_DROP_PCT 를 넘게 빠지면 그 경주는 건너뛴다.
    같은 날 다른 경주로 옮긴 말은 옛 경주 행이 후보가 된다 (그 경주엔 더 이상 없으므로).
    """
    seen: dict[int, set[str]] = {}
    for r in fetched:
        rn, hno = r.get("race_no"), r.get("horse_no")
        if rn is None or not hno:
            continue
        seen.setdefault(int(rn), set()).add(str(hno))
    if not seen:
        return set()

    out: set[tuple[int, str]] = set()
    for race_no, horses in active.items():
        if race_no not in seen or not horses:
            continue
        gone = horses - seen[race_no]
        if not gone:
            continue
        if len(gone) * 100 > SCRATCH_MAX_DROP_PCT * len(horses):
            log.warning(
                "race_entries_scratch_guard",
                race_no=race_no, active=len(horses), missing=len(gone),
            )
            continue
        out.update((race_no, h) for h in gone)
    return out


def mark_scratches(d: date, meet: str, fetched: list[dict[str, Any]]) -> int:
    """재수집에서 빠진 출전마에 scratched_at 표시.

    오늘(KST) 이전 경주일은 이력이라 건드리지 않는다.
    """
    if d < datetime.now(KST).date() or not fetched:
        return 0
    with session_scope() as s:
        rows = s.execute(
            text(
                "SELECT race_no, horse_no FROM race_entries "
                "WHERE race_date = :d AND meet = :m AND scratched_at IS NULL"
            ),
            {"d": d, "m": meet},
        ).all()
        active: dict[int, set[str]] = {}
        for rn, hno in rows:
            active.setdefault(int(rn), set()).add(str(hno))
        cands = scratch_candidates(active, fetched)
        if not cands:
            return 0
        for rn, hno in sorted(cands):
            s.execute(
                text(
                    "UPDATE race_entries SET scratched_at = now() "
                    "WHERE race_date = :d AND meet = :m AND race_no = :rn "
                    "AND horse_no = :h AND scratched_at IS NULL"
                ),
                {"d": d, "m": meet, "rn": rn, "h": hno},
            )
    log.info(
        "race_entries_scratched",
        date=str(d), meet=meet,
        keys=[f"{rn}:{h}" for rn, h in sorted(cands)],
    )
    return len(cands)


def store_entries(d: date, items: list[dict[str, Any]], *, meet: int | None = None) -> int:
    """(경주일, 경마장) 출전표 응답 → upsert + races skeleton + 출전취소 표시.

    meet 는 items 를 받은 요청의 경마장 코드 — meet 라벨 정규화에 쓴다.
    """
    mapped = [api_item_to_race_entry_fields(it, meet=meet) for it in items]
    n = upsert_race_entries(mapped)
    # 출전표 수집 시점에 races 테이블에도 예정 경주 행을 즉시 만들어
    # 메인 페이지 "다음 진행 예정 경기" 섹션에 반영되도록 한다.
    upsert_races_skeleton(mapped)
    for label in sorted({r["meet"] for r in mapped if r.get("meet")}):
        mark_scratches(d, label, [r for r in mapped if r.get("meet") == label])
    return n


def sync_dates(dates: Iterable[date], meets: Iterable[int] = MEETS) -> int:
    """일자 × 경마장 출전표 → upsert + races skeleton + 출전취소 표시.

    fetch 단위 실패는 경고, 전부 실패면 RuntimeError. 어떤 날짜의 경마장 조회가
    모두 실패하면 그날이 경주일인지 알 수 없으므로 RuntimeError (조용한 0건 방지).
    """
    total = 0
    fails = UnitFailures("race_entries")
    meets = list(meets)
    unknown: list[date] = []  # 경마장 조회 모두 실패 → 경주일 여부 미확인
    race_days: list[date] = []
    with RaceChulmaClient() as client:
        for d in dates:
            meet_errors = 0
            day_items = 0
            for meet in meets:
                try:
                    items = client.list_by_date(d, meet=meet)
                except Exception as exc:  # noqa: BLE001
                    if not is_kra_no_data(exc):  # NODATA 는 정상 0건
                        meet_errors += 1
                    fails.fail(exc, "race_entries_fetch_failed", date=str(d), meet=meet)
                    continue
                fails.ok()
                log.info("race_entries_fetched", date=str(d), meet=meet, count=len(items))
                day_items += len(items)
                total += store_entries(d, items, meet=meet)
            if meets and meet_errors == len(meets):
                unknown.append(d)
            elif day_items:
                race_days.append(d)
    log.info(
        "race_entries_race_days",
        dates=[str(d) for d in race_days],
        weekday_race_days=[
            str(d) for d in race_days if d.weekday() not in WEEKEND_RACE_WEEKDAYS
        ],
    )
    fails.raise_if_all_failed()
    if unknown:
        raise RuntimeError(
            "race_entries: 경주일 확인 불가 — 경마장 조회가 모두 실패한 날짜 "
            + ", ".join(str(d) for d in unknown)
            + f" (첫 오류: {redact(fails.first_error or '')[:200]})"
        )
    return total


def sync_upcoming(days_ahead: int = 10) -> int:
    """오늘(KST)로부터 며칠 이내의 예정 경주일 모두 fetch."""
    today = datetime.now(KST).date()
    return sync_dates(_upcoming_race_dates(today, days_ahead=days_ahead))
