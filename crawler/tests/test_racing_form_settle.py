"""경마지 정산 (계약 §6) + 표시 판정 (§6.1)."""

from __future__ import annotations

import hashlib
import json
import random
from datetime import UTC, date, datetime
from typing import Any

import pytest
from racing_form_fakes import kst

from src.racing_form import definitions, settle
from src.racing_form.settle import OFFICIAL, PENDING, RACE_VOID, pick_outcome, settle_race
from src.racing_form.types import DividendRow, ResultRow

R1 = definitions.get("r1")
D = date(2026, 11, 15)
RACE_NIGHT = kst(2026, 11, 15, 22, 45)


def race(n: int = 5, race_no: int = 1) -> dict[str, Any]:
    return {
        "race_no": race_no,
        "runners": [{"horse_no": f"H{i}", "chul_no": i} for i in range(1, n + 1)],
    }


def res(
    horse: str,
    rank: int | None,
    chul: int | str | None,
    time: str | None = "72.0",
    race_no: int = 1,
) -> ResultRow:
    return ResultRow(race_no, horse, rank, time, None if chul is None else str(chul))


def full_results(n: int = 5) -> list[ResultRow]:
    return [res(f"H{i}", i, i, f"{71 + i}.0") for i in range(1, n + 1)]


def test_official_basic_and_finish_order() -> None:
    rows = list(reversed(full_results()))
    out = settle_race(race(), rows, [], RACE_NIGHT, D, R1)
    assert out.status == OFFICIAL
    assert out.starters == 5
    assert [f["horse_no"] for f in out.finish] == ["H1", "H2", "H3", "H4", "H5"]
    assert out.finish[0] == {"horse_no": "H1", "chul_no": 1, "rank": 1, "time_tenths": 720}
    assert out.winners == ["H1"]
    assert out.placed == ["H1", "H2", "H3"]
    assert out.non_starters == [] and out.extra_starters == []
    assert out.favorites == [] and out.pop_ranks == {}


def test_dead_heat() -> None:
    rows = [res("H1", 1, 1), res("H2", 1, 2), res("H3", 3, 3), res("H4", 3, 4), res("H5", 5, 5)]
    out = settle_race(race(), rows, [], RACE_NIGHT, D, R1)
    assert out.winners == ["H1", "H2"]
    assert out.placed == ["H1", "H2", "H3", "H4"]
    assert pick_outcome("H2", out) == "win"
    assert pick_outcome("H4", out) == "top3"
    assert pick_outcome("H5", out) == "miss"


def test_result_row_rank_null_is_miss_and_missing_row_is_void() -> None:
    rows = [res("H1", 1, 1), res("H2", 2, 2), res("H3", 3, 3), res("H4", None, 4, time="-")]
    out = settle_race(race(), rows, [], RACE_NIGHT, D, R1)
    assert out.status == OFFICIAL
    assert out.non_starters == ["H5"]
    assert out.finish[-1] == {"horse_no": "H4", "chul_no": 4, "rank": None, "time_tenths": None}
    assert pick_outcome("H4", out) == "miss"  # 결과 행 있음 → 주행중지·실격도 빗나감
    assert pick_outcome("H5", out) == "void"  # 결과 행 없음 → 무효
    # rank 0 도 착순 없음
    out0 = settle_race(race(), [*rows[:3], res("H4", 0, 4)], [], RACE_NIGHT, D, R1)
    assert out0.finish[-1]["rank"] is None


def test_extra_starter() -> None:
    rows = [*full_results(5), res("X9", 6, 6)]
    out = settle_race(race(), rows, [], RACE_NIGHT, D, R1)
    assert out.extra_starters == ["X9"]
    assert out.starters == 6


def test_pending_below_half_of_published() -> None:
    rows = full_results(10)
    assert settle_race(race(10), rows[:4], [], RACE_NIGHT, D, R1).status == PENDING
    assert settle_race(race(10), rows[:5], [], RACE_NIGHT, D, R1).status == OFFICIAL


def test_all_rank_null_void_after_d1_1230() -> None:
    rows = [res(f"H{i}", None, i, time="72.0") for i in range(1, 6)]
    assert settle_race(race(), rows, [], kst(2026, 11, 16, 12, 29), D, R1).status == PENDING
    out = settle_race(race(), rows, [], kst(2026, 11, 16, 12, 30), D, R1)
    assert out.status == RACE_VOID
    assert out.winners == [] and out.placed == []
    assert pick_outcome("H1", out) == "void"


def test_no_results_void_from_d7() -> None:
    assert settle_race(race(), [], [], kst(2026, 11, 21, 23, 45), D, R1).status == PENDING
    out = settle_race(race(), [], [], kst(2026, 11, 22, 10, 15), D, R1)
    assert out.status == RACE_VOID
    assert out.starters == 0
    assert out.non_starters == ["H1", "H2", "H3", "H4", "H5"]
    # UTC 로 넘겨도 KST 날짜 기준 (UTC 11-21 15:30 = KST 11-22 00:30)
    utc = datetime(2026, 11, 21, 15, 30, tzinfo=UTC)
    assert settle_race(race(), [], [], utc, D, R1).status == RACE_VOID


def test_favorites_ties_pop_ranks_and_chul_mapping() -> None:
    rows = [res("H1", 2, 1), res("H2", 1, 2), res("H3", 3, 3), res("H4", 4, 4), res("H5", 5, 5)]
    divs = [
        DividendRow(1, "2", "2.1"),
        DividendRow(1, "4", "2.1"),  # 동률 → 둘 다 1번 인기
        DividendRow(1, "1", "3.5"),
        DividendRow(1, "03", "12.0"),  # '03' → 3
        DividendRow(1, "5", "0"),  # 배당 0 → 무시
        DividendRow(1, "9", "1.1"),  # 매핑 불가 출전번호 → 무시
        DividendRow(2, "1", "1.0"),  # 다른 경주
    ]
    out = settle_race(race(), rows, divs, RACE_NIGHT, D, R1)
    assert out.favorites == ["H2", "H4"]
    assert out.pop_ranks == {"H2": 1, "H4": 1, "H1": 3, "H3": 4}


def test_dividend_mapping_falls_back_to_published_chul_no() -> None:
    rows = [res("H1", 1, None), res("H2", 2, 2), res("H3", 3, 3), res("H4", 4, 4), res("H5", 5, 5)]
    out = settle_race(race(), rows, [DividendRow(1, "1", "1.8")], RACE_NIGHT, D, R1)
    assert out.favorites == ["H1"]  # 결과에 chulNo 가 없으면 발행본 출전번호로
    assert out.finish[0]["chul_no"] is None


def test_digest_stable_and_sensitive() -> None:
    rows = full_results()
    divs = [DividendRow(1, str(i), f"{i}.5") for i in range(1, 6)]
    base = settle_race(race(), rows, divs, RACE_NIGHT, D, R1)
    rng = random.Random(7)
    for _ in range(5):
        r2, d2 = rows[:], divs[:]
        rng.shuffle(r2)
        rng.shuffle(d2)
        assert settle_race(race(), r2, d2, RACE_NIGHT, D, R1).results_digest == base.results_digest
    body = json.dumps(
        {"finish": base.finish, "favorites": base.favorites, "status": base.status},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    assert base.results_digest == hashlib.sha256(body.encode()).hexdigest()
    changed = [res("H1", 2, 1), res("H2", 1, 2), *rows[2:]]
    assert (
        settle_race(race(), changed, divs, RACE_NIGHT, D, R1).results_digest != base.results_digest
    )
    # 정산 시각이 달라도(같은 상태) digest 같음
    later = settle_race(race(), rows, divs, kst(2026, 11, 16, 13, 15), D, R1)
    assert later.results_digest == base.results_digest


def test_outcome_row_and_pick_outcome_from_db_dict() -> None:
    out = settle_race(race(), full_results(), [], RACE_NIGHT, D, R1)
    row = out.to_row()
    assert set(row) == {
        "race_no",
        "status",
        "starters",
        "finish",
        "winners",
        "placed",
        "non_starters",
        "extra_starters",
        "favorites",
        "pop_ranks",
        "results_digest",
    }
    assert pick_outcome("H1", row) == "win"
    assert pick_outcome("H3", row) == "top3"
    assert pick_outcome("H4", row) == "miss"
    assert pick_outcome("H1", None) == "pending"
    assert pick_outcome("H1", {"status": "pending"}) == "pending"
    assert pick_outcome("H1", {"status": "race_void", "winners": ["H1"]}) == "void"
    assert pick_outcome("H9", {"status": "official", "non_starters": ["H9"]}) == "void"


def test_results_for_other_races_are_ignored() -> None:
    rows = [*full_results(), res("Z1", 1, 1, race_no=2)]
    out = settle_race(race(), rows, [], RACE_NIGHT, D, R1)
    assert out.starters == 5 and out.extra_starters == []


def test_naive_now_rejected() -> None:
    with pytest.raises(ValueError):
        settle_race(race(), [], [], datetime(2026, 11, 15, 22, 0), D, R1)
    assert settle.PENDING == "pending"
