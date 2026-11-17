"""출전취소 후보 판정 (`sync_race_entries.scratch_candidates`) — DB 없이."""
from __future__ import annotations

from src.jobs.sync_race_entries import scratch_candidates


def _rows(race_no: int, *horses: str) -> list[dict]:
    return [{"race_no": race_no, "horse_no": h} for h in horses]


def test_missing_horse_is_candidate():
    active = {1: {"A", "B", "C"}}
    assert scratch_candidates(active, _rows(1, "A", "C")) == {(1, "B")}


def test_nothing_missing():
    active = {1: {"A", "B"}}
    assert scratch_candidates(active, _rows(1, "B", "A", "Z")) == set()


def test_empty_fetch_marks_nothing():
    assert scratch_candidates({1: {"A", "B", "C"}}, []) == set()


def test_rows_without_keys_count_as_empty():
    fetched = [{"race_no": None, "horse_no": "A"}, {"race_no": 1, "horse_no": ""}]
    assert scratch_candidates({1: {"A", "B", "C"}}, fetched) == set()


def test_race_absent_from_response_is_untouched():
    active = {1: {"A", "B", "C"}, 2: {"D", "E", "F"}}
    assert scratch_candidates(active, _rows(1, "A", "B")) == {(1, "C")}


def test_drop_guard_skips_race():
    # 4두 중 3두가 빠짐(75% > 50%) → 응답 이상으로 보고 표시하지 않음
    active = {1: {"A", "B", "C", "D"}, 2: {"E", "F", "G"}}
    fetched = _rows(1, "A") + _rows(2, "E", "F")
    assert scratch_candidates(active, fetched) == {(2, "G")}


def test_half_drop_is_allowed():
    active = {1: {"A", "B", "C", "D"}}
    assert scratch_candidates(active, _rows(1, "A", "B")) == {(1, "C"), (1, "D")}


def test_horse_moved_to_other_race_marks_old_row():
    active = {1: {"A", "B", "C"}, 2: {"D", "E", "F"}}
    fetched = _rows(1, "A", "B") + _rows(2, "C", "D", "E", "F")
    assert scratch_candidates(active, fetched) == {(1, "C")}


def test_string_race_no_is_normalised():
    active = {3: {"A", "B", "C"}}
    fetched = [{"race_no": "3", "horse_no": "A"}, {"race_no": "3", "horse_no": "B"}]
    assert scratch_candidates(active, fetched) == {(3, "C")}
