"""경마지 특징 — 출주 분류·활성 출전마(stale·dup·50% 경고)·실제 기수·as-of·말별 수치."""

from __future__ import annotations

from dataclasses import replace
from datetime import date, timedelta

import pytest
from racing_form_fakes import entry_row, hist_row, kst

from src.racing_form import definitions, features
from src.racing_form.features import RANKED, UNRANKED, classify_start

R1 = definitions.get("r1")
D = date(2026, 11, 15)
H = date(2026, 11, 14)
BATCH = kst(2026, 11, 14, 15, 0)


def ago(n: int) -> date:
    return H - timedelta(days=n)


# ---------------------------------------------------------------------------
# §1.1 출주 분류
# ---------------------------------------------------------------------------


def test_classify_start() -> None:
    assert classify_start(1, 728) == RANKED
    assert classify_start(12, None) == RANKED
    assert classify_start(None, 728) == UNRANKED
    assert classify_start(0, 728) == UNRANKED
    assert classify_start(None, None) is None
    assert classify_start(0, None) is None
    assert classify_start(0, 0) is None


def test_to_start_drops_non_starters_and_keeps_unranked() -> None:
    rows = [
        hist_row("A", ago(30), 2),
        hist_row("A", ago(20), None, time="73.1"),  # 실격 등 — 출주, 착순 없음
        hist_row("A", ago(10), 0, time="-"),  # 미출주
        hist_row("A", ago(5), None, time="0"),  # 미출주
    ]
    starts = features.starts_of(rows, R1)
    assert [(s.race_date, s.rank) for s in starts] == [(ago(30), 2), (ago(20), None)]
    assert starts[1].time_tenths == 731


# ---------------------------------------------------------------------------
# §1.2 활성 출전마
# ---------------------------------------------------------------------------


def _e(race_no: int, horse_no: str, chul: int | None, minutes_old: int = 0, **kw: object):
    ts = BATCH - timedelta(minutes=minutes_old)
    return entry_row(race_no, horse_no, chul, updated_at=ts, **kw)  # type: ignore[arg-type]


def test_stale_rows_are_dropped_within_tolerance_kept() -> None:
    rows = [
        _e(1, "A", 1),
        _e(1, "B", 2, minutes_old=29),  # 허용 30분 안
        _e(1, "C", 3, minutes_old=30),  # 경계 — batch−30분 과 같으면 stale 아님
        _e(1, "D", 4, minutes_old=31),  # stale
        _e(1, "E", 5),
    ]
    by_race, warnings = features.select_active_entries(rows, R1)
    assert [r.horse_no for r in by_race[1]] == ["A", "B", "C", "E"]
    assert warnings == []


def test_stale_guard_keeps_race_when_more_than_half_would_drop() -> None:
    half = [_e(1, "A", 1), _e(1, "B", 2), _e(1, "C", 3, 60), _e(1, "D", 4, 60)]  # 2/4 = 50%
    by_race, warnings = features.select_active_entries(half, R1)
    assert [r.horse_no for r in by_race[1]] == ["A", "B"]
    assert warnings == []

    over = [_e(2, "A", 1), _e(2, "B", 2, 60), _e(2, "C", 3, 60), _e(2, "D", 4, 60)]  # 3/4
    by_race, warnings = features.select_active_entries(over, R1)
    assert [r.horse_no for r in by_race[2]] == ["A", "B", "C", "D"]
    assert warnings == ["stale_kept:2"]


def test_batch_at_is_max_updated_at_over_partition() -> None:
    rows = [_e(1, "A", 1, 120), _e(2, "B", 1, 0)]
    assert features.entries_batch_at(rows) == BATCH
    by_race, _ = features.select_active_entries(rows, R1)
    # 1R 은 1/1 = 100% stale → 빼지 않고 경고
    assert [r.horse_no for r in by_race[1]] == ["A"]
    assert features.entries_batch_at([]) is None


def test_duplicate_same_day_keeps_latest_then_higher_race_no() -> None:
    rows = [
        _e(1, "A", 1, minutes_old=10),
        _e(3, "A", 4, minutes_old=5),  # 최신 → 3R
        _e(1, "B", 2),
        _e(2, "B", 3),  # updated_at 동률 → race_no 큰 2R
        _e(1, "C", 3),
    ]
    by_race, _ = features.select_active_entries(rows, R1)
    assert {k: [r.horse_no for r in v] for k, v in by_race.items()} == {
        1: ["C"],
        2: ["B"],
        3: ["A"],
    }


def test_exclusions_and_order() -> None:
    rows = [
        _e(1, "B", 7),
        _e(1, "  ", 2),  # horse_no 없음
        replace(_e(1, "X", 3), meet="알수없음"),  # meet 이상
        _e(1, "A", 1),
        _e(1, "N", None),  # 출전번호 없음 → 제외 + 경고
        replace(_e(2, "P", 1), meet="부산경남"),  # 정규화 가능 → 유지
    ]
    by_race, warnings = features.select_active_entries(rows, R1)
    assert [r.horse_no for r in by_race[1]] == ["A", "B"]
    assert [r.horse_no for r in by_race[2]] == ["P"]
    assert warnings == ["missing_chul_no:1"]


def test_effective_jockey_budam_rating() -> None:
    plain = entry_row(1, "A", 1, jockey=" 한교체 ", wg_budam="55.0", rating=0, raw_hr_rating="64")
    r = features.to_runner(plain)
    assert r.jockey_name == "한교체"
    assert r.budam_tenths == 550
    assert r.rating == 64  # rating 0 → raw hrRating
    assert r.jockey_change is None

    changed = entry_row(
        1,
        "A",
        1,
        jockey="한교체",
        wg_budam="55.0",
        rating=70,
        jc_before="한교체",
        jc_after=" 이과천 ",
        jc_reason="기수 부상",
        jc_weight_before="55.0",
        jc_weight_after="54.0",
    )
    r = features.to_runner(changed)
    assert r.jockey_name == "이과천"
    assert r.budam_tenths == 540
    assert r.rating == 70
    assert r.jockey_change is not None
    assert r.jockey_change.to_json() == {
        "before": "한교체",
        "after": "이과천",
        "reason": "기수 부상",
        "weight_before_tenths": 550,
        "weight_after_tenths": 540,
    }

    # after 가 빈 문자열이면 NULL 취급 → 출전표 기수, 부담 after 없음 → wgBudam
    blank = entry_row(1, "A", 1, jockey="한교체", wg_budam="56", jc_after="  ", jc_reason="사유")
    r = features.to_runner(blank)
    assert r.jockey_name == "한교체"
    assert r.budam_tenths == 560
    assert r.jockey_change is not None and r.jockey_change.after is None

    none = entry_row(1, "A", 1, rating=None, raw_hr_rating="", wg_budam=None)
    r = features.to_runner(none)
    assert r.rating is None and r.budam_tenths is None


def test_race_distance_coalesce_then_range() -> None:
    assert features.race_distance(1200, "1400", R1) == 1200
    assert features.race_distance(None, "1400", R1) == 1400
    assert features.race_distance(None, None, R1) is None
    # COALESCE 가 먼저 — races.distance 가 범위 밖이면 rcDist 로 넘어가지 않는다
    assert features.race_distance(600, "1200", R1) is None


# ---------------------------------------------------------------------------
# as-of
# ---------------------------------------------------------------------------


def test_assert_strictly_before() -> None:
    features.assert_strictly_before([hist_row("A", ago(1), 1)], H)
    features.assert_strictly_before([], H)
    with pytest.raises(ValueError, match="as-of"):
        features.assert_strictly_before([hist_row("A", ago(1), 1), hist_row("A", H, 1)], H)
    with pytest.raises(ValueError):
        features.assert_strictly_before([hist_row("A", D, 1)], H)


def test_compute_features_rejects_leak() -> None:
    with pytest.raises(ValueError):
        features.compute_features(
            "A", [hist_row("A", H, 1)], d=D, h=H, meet="서울", distance=1200, defn=R1
        )


# ---------------------------------------------------------------------------
# 말별 특징
# ---------------------------------------------------------------------------


def _feat(rows, *, distance: int | None = 1200, meet: str = "서울"):
    return features.compute_features("A", rows, d=D, h=H, meet=meet, distance=distance, defn=R1)


def test_career_last5_and_last_start() -> None:
    rows = [
        hist_row("A", ago(10 * n), rk, race_no=n)
        for n, rk in zip(range(7, 0, -1), [5, 4, 1, 2, 3, 1, 6], strict=True)
    ]
    rows.append(hist_row("A", ago(3), None, time="-"))  # 미출주 — 무시
    rows.append(hist_row("B", ago(2), 1))  # 다른 말 — 무시
    f = _feat(rows)
    assert (f.career_starts, f.career_wins, f.career_top3) == (7, 2, 4)
    assert [s.rank for s in f.last5] == [1, 2, 3, 1, 6]  # 오래된 → 최근
    assert [s.race_date for s in f.last5] == sorted(s.race_date for s in f.last5)
    assert f.last is not None and f.last.race_date == ago(10)
    assert f.days_since_last == (D - ago(10)).days == 11
    assert f.history_rows == 8


def test_form_window_boundary_and_last_three() -> None:
    rows = [
        hist_row("A", ago(366), 1),  # 창 밖
        hist_row("A", ago(365), 2),  # 창 안 (H−365 포함)
        hist_row("A", ago(100), 5),
        hist_row("A", ago(50), None, time="74.0"),
        hist_row("A", ago(20), 3),
    ]
    f = _feat(rows)
    assert f.form.window_starts == 4
    assert [s.rank for s in f.form.used] == [5, None, 3]
    assert (f.form.top3, f.form.wins, f.form.last_rank) == (1, 0, 3)
    assert (f.form.rank_sum, f.form.rank_n) == (8, 2)


def test_form_last_rank_none_when_latest_unranked() -> None:
    f = _feat([hist_row("A", ago(30), 1), hist_row("A", ago(10), None, time="70.0")])
    assert f.form.last_rank is None
    assert f.win_streak == 0  # 순위 없음이 연승을 끊는다


def test_course_and_best_time_same_meet_distance() -> None:
    rows = [
        hist_row("A", ago(400), 1, distance=1200, time="72.5", track="건조"),
        hist_row(
            "A", ago(300), 4, distance=1200, time="72.5", track="불량"
        ),  # 같은 기록 — 먼저 낸 것
        hist_row("A", ago(200), 2, distance=1200, time="73.0"),
        hist_row("A", ago(150), 1, distance=1200, meet="부경", time="70.0"),  # 다른 경마장
        hist_row("A", ago(100), 1, distance=1400, time="71.0"),  # 다른 거리
        hist_row("A", ago(50), None, distance=1200, time="71.9"),  # 순위 없음도 출주·기록
    ]
    f = _feat(rows)
    assert f.course is not None
    assert (f.course.meet, f.course.distance) == ("서울", 1200)
    assert (f.course.starts, f.course.wins, f.course.top3) == (4, 1, 2)
    assert f.best_time is not None
    assert (f.best_time.time_tenths, f.best_time.race_date) == (719, ago(50))
    f2 = _feat(rows[:3])
    assert f2.best_time is not None
    assert (f2.best_time.time_tenths, f2.best_time.race_date, f2.best_time.track_condition) == (
        725,
        ago(400),
        "건조",
    )
    assert _feat(rows, distance=None).course is None
    assert _feat(rows, distance=None).best_time is None


def test_history_distance_coalesce_from_raw() -> None:
    row = replace(hist_row("A", ago(10), 1, distance=None), raw_rc_dist="1400")
    f = _feat([row], distance=1400)
    assert f.course is not None and f.course.starts == 1
    assert f.distances == frozenset({1400})


def test_ratings_distances_jockeys_streak() -> None:
    rows = [
        hist_row("A", ago(90), 2, hr_rating=70, jockey="갑", distance=1400),
        hist_row("A", ago(60), 1, hr_rating="68", jockey="을", distance=1200),
        hist_row("A", ago(30), 1, hr_rating="0", jockey="갑", distance=1200),
        hist_row("A", ago(10), 1, hr_rating=None, jockey=" 병 ", distance=None),
    ]
    f = _feat(rows)
    assert f.rating_prev is None  # 가장 최근 출주의 hrRating 만 (없으면 None)
    assert (f.max_rating, f.rated_starts) == (70, 2)
    assert f.distances == frozenset({1200, 1400})
    assert f.jockeys == frozenset({"갑", "을", "병"})
    assert f.win_streak == 3


def test_no_history() -> None:
    f = _feat([])
    assert f.starts == ()
    assert (f.career_starts, f.days_since_last, f.last, f.rating_prev) == (0, None, None, None)
    assert f.course is not None and f.course.starts == 0
    assert f.form.window_starts == 0 and f.form.used == ()
