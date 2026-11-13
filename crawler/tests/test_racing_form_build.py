"""경마지 build_edition — as-of(토→일 연속 경주일)·live 가드·mode·발행 창·D 결과·경고."""

from __future__ import annotations

import copy
from datetime import date, timedelta
from typing import Any

import pytest
from racing_form_fakes import (
    GOLDEN_D,
    GOLDEN_MEET,
    GOLDEN_NOW,
    FakeProvider,
    kst,
    payload_scenario,
)

from src.racing_form import build, definitions
from src.racing_form.build import GuardError, NotPublishable, build_edition
from src.racing_form.payload import canonical_json
from src.racing_form.types import HistoryRow

R1 = definitions.get("r1")
D = GOLDEN_D  # 일요일
H = date(2026, 11, 14)  # 토요일 (D−1)
SAT = H


def _strip_warnings(pl: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(pl)
    out["edition"]["warnings"] = []
    return out


def _computed_jockey_world() -> FakeProvider:
    """골든 시나리오 + '정마루' 기수 집계를 결과 행에서 계산 (override 제거)."""
    p = payload_scenario()
    del p.jockey_overrides[("정마루", "서울")]
    for i in range(25):  # [H−90, H) 25기승 5승
        p.add_result(
            H - timedelta(days=3 + 3 * i),
            "서울",
            8,
            f"F{i:03d}",
            1 if i % 5 == 0 else 6,
            jockey="정마루",
            jk_no="0777" if i % 2 else None,
            distance=1200,
        )
    return p


def _add_saturday(p: FakeProvider) -> None:
    """D−1(토) 결과 — 정정 전이라 이력·집계·성적 반영일 어디에도 들어가면 안 된다."""
    p.add_race(SAT, "서울", 1, distance=1200)
    p.add_result(SAT, "서울", 1, "0041001", 1, jockey="김가람", distance=1200, hr_rating=90)
    p.add_result(SAT, "서울", 1, "0042005", 1, jockey="송이랑", distance=1400)
    for i in range(5):
        p.add_result(SAT, "서울", 1, f"S{i:03d}", 1, jockey="정마루", jk_no="0999")
    p.add_result(SAT, "부경", 2, "0042003", 1, jockey="임새벽", distance=1400)


# ---------------------------------------------------------------------------
# as-of
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["live", "replay", "backtest"])
def test_saturday_results_do_not_change_sunday_edition(mode: str) -> None:
    base = build_edition(_computed_jockey_world(), D, GOLDEN_MEET, GOLDEN_NOW, R1, mode=mode)
    p = _computed_jockey_world()
    _add_saturday(p)
    with_sat = build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode=mode)
    assert canonical_json(with_sat.payload) == canonical_json(base.payload)
    assert with_sat.picks == base.picks
    assert with_sat.extra_rule_results == base.extra_rule_results
    assert base.meta["results_through"] == with_sat.meta["results_through"] < H
    # 집계가 실제로 결과 행에서 계산됐는지 (정마루 25기승 5승, 번호 하나 → 동명이인 아님)
    jockey = base.payload["races"][0]["rules"][3]
    assert jockey["status"] == "picked"
    assert "정마루 기수 · 최근 90일 서울 25번 중 5승 (승률 20%)" in [
        x["reason"] for x in jockey["picks"]
    ]


class LeakyProvider(FakeProvider):
    """history 가 race_date < h 를 지키지 않는 잘못된 provider."""

    def history(self, horse_nos: list[str], h: date) -> list[HistoryRow]:
        return super().history(horse_nos, h + timedelta(days=2))


def test_as_of_double_check_raises_on_leaky_provider() -> None:
    p = payload_scenario()
    leaky = LeakyProvider()
    leaky.__dict__.update(p.__dict__)
    _add_saturday(leaky)
    with pytest.raises(ValueError, match="as-of"):
        build_edition(leaky, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="replay")


# ---------------------------------------------------------------------------
# live 발행 조건 · 가드
# ---------------------------------------------------------------------------


def test_window_enforced_and_warning_when_not_enforced() -> None:
    early = kst(2026, 11, 14, 17, 59)
    with pytest.raises(NotPublishable) as ei:
        build_edition(payload_scenario(), D, GOLDEN_MEET, early, R1, enforce_window=True)
    assert ei.value.code == "not_in_window"
    res = build_edition(payload_scenario(), D, GOLDEN_MEET, early, R1)
    assert "not_in_window" in res.warnings
    assert "not_in_window" not in res.payload["edition"]["warnings"]
    late = kst(2026, 11, 15, 8, 0)  # 마감 = min(08:00, 10:35 − 60분) = 08:00
    with pytest.raises(NotPublishable):
        build_edition(payload_scenario(), D, GOLDEN_MEET, late, R1, enforce_window=True)
    ok = build_edition(
        payload_scenario(), D, GOLDEN_MEET, kst(2026, 11, 15, 7, 59), R1, enforce_window=True
    )
    assert "not_in_window" not in ok.warnings
    # replay·backtest 는 창을 보지 않는다
    for mode in ("replay", "backtest"):
        build_edition(payload_scenario(), D, GOLDEN_MEET, early, R1, mode=mode, enforce_window=True)


def test_results_present_blocks_live_only() -> None:
    p = payload_scenario()
    p.add_result(D, GOLDEN_MEET, 1, "0041003", 1)
    with pytest.raises(NotPublishable) as ei:
        build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1)
    assert ei.value.code == "results_present"
    build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="replay")


def test_guard_no_entries() -> None:
    p = FakeProvider()
    p.add_race(D, GOLDEN_MEET, 1)
    with pytest.raises(GuardError) as ei:
        build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1)
    assert ei.value.code == "no_entries"
    res = build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="replay")
    assert res.payload["races"] == [] and res.picks == []
    assert res.meta["race_count"] == 0 and res.meta["runner_count"] == 0


def _veteran_world(*, history: bool) -> FakeProvider:
    """2경주 × 6두, 모두 레이팅 있음 + 마스터상 경력마. history=False 면 이력 행 없음."""
    p = FakeProvider()
    for race_no in (1, 2):
        p.add_race(D, GOLDEN_MEET, race_no, distance=1200, start_time="10:35")
        for chul in range(1, 7):
            hn = f"V{race_no}{chul}"
            p.add_entry(D, GOLDEN_MEET, race_no, hn, chul, rating=50 + chul)
            p.set_master(hn, 7)
            if history:
                p.add_result(H - timedelta(days=20), GOLDEN_MEET, 3, hn, chul, distance=1400)
    return p


def test_guard_history_coverage_low_live_only() -> None:
    with pytest.raises(GuardError) as ei:
        build_edition(_veteran_world(history=False), D, GOLDEN_MEET, GOLDEN_NOW, R1)
    assert ei.value.code == "history_coverage_low"
    build_edition(_veteran_world(history=True), D, GOLDEN_MEET, GOLDEN_NOW, R1)
    for mode in ("replay", "backtest"):
        res = build_edition(
            _veteran_world(history=False), D, GOLDEN_MEET, GOLDEN_NOW, R1, mode=mode
        )
        assert len(res.payload["races"]) == 2


def test_guard_coverage_needs_ten_veterans() -> None:
    p = FakeProvider()
    p.add_race(D, GOLDEN_MEET, 1, distance=1200)
    for chul in range(1, 10):  # 경력마 9두 — 가드 대상 아님
        hn = f"N{chul}"
        p.add_entry(D, GOLDEN_MEET, 1, hn, chul, rating=50 + chul)
        p.set_master(hn, 3)
    build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1)


def test_guard_all_nopick_majority() -> None:
    p = FakeProvider()
    for race_no, rated in ((1, True), (2, False), (3, False)):
        p.add_race(D, GOLDEN_MEET, race_no, distance=1200)
        for chul in range(1, 6):
            hn = f"P{race_no}{chul}"
            p.add_entry(D, GOLDEN_MEET, race_no, hn, chul, rating=(60 + chul) if rated else None)
            p.set_master(hn, 0)
    with pytest.raises(GuardError) as ei:
        build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1)
    assert ei.value.code == "all_nopick_majority"
    res = build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="replay")
    assert [r["rules"][0]["status"] for r in res.payload["races"]] == [
        "picked",
        "no_pick",
        "no_pick",
    ]
    # r1-e2e 는 이 가드를 끈다 (100%)
    build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, definitions.get("r1-e2e"))


def test_guard_all_nopick_exactly_half_passes() -> None:
    p = FakeProvider()
    for race_no, rated in ((1, True), (2, False)):
        p.add_race(D, GOLDEN_MEET, race_no, distance=1200)
        for chul in range(1, 6):
            hn = f"Q{race_no}{chul}"
            p.add_entry(D, GOLDEN_MEET, race_no, hn, chul, rating=(60 + chul) if rated else None)
            p.set_master(hn, 0)
    build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1)  # 1/2 = 50% — 넘지 않음


# ---------------------------------------------------------------------------
# 경고
# ---------------------------------------------------------------------------


def test_entries_stale_warning_live_only() -> None:
    p = payload_scenario()  # 배치 15:00
    fresh = build_edition(p, D, GOLDEN_MEET, kst(2026, 11, 14, 21, 0), R1)
    assert "entries_stale" not in fresh.payload["edition"]["warnings"]  # 정확히 6시간
    stale = build_edition(p, D, GOLDEN_MEET, kst(2026, 11, 14, 21, 1), R1)
    assert "entries_stale" in stale.payload["edition"]["warnings"]
    replay = build_edition(p, D, GOLDEN_MEET, kst(2026, 11, 15, 7, 0), R1, mode="replay")
    assert replay.payload["edition"]["warnings"] == []


def test_stale_kept_warning_reaches_payload() -> None:
    p = payload_scenario()
    for chul in range(10, 17):  # 1R 에 오래된 행 7개 → 7/13 > 50% → 빼지 않고 경고
        p.add_entry(D, GOLDEN_MEET, 1, f"Z{chul}", chul, updated_at=kst(2026, 11, 14, 9, 0))
    res = build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="replay")
    assert res.payload["edition"]["warnings"] == ["stale_kept:1"]
    assert res.payload["races"][0]["field_size"] == 14


# ---------------------------------------------------------------------------
# mode 차이
# ---------------------------------------------------------------------------


def test_replay_equals_live_except_live_warnings() -> None:
    live = build_edition(payload_scenario(), D, GOLDEN_MEET, GOLDEN_NOW, R1)
    replay = build_edition(
        payload_scenario(), D, GOLDEN_MEET, kst(2026, 11, 20, 9, 0), R1, mode="replay"
    )
    assert live.payload["edition"]["warnings"] == ["unresolved_history:2026-11-09|서울"]
    assert _strip_warnings(live.payload) == _strip_warnings(replay.payload)
    assert live.picks == replay.picks


def test_backtest_skips_news_and_adds_extra_rules() -> None:
    p = payload_scenario()
    p.set_trainer_stat("박조교", "서울", 40, 8, 15)
    p.set_trainer_stat("최조교", "서울", 30, 3, 9)
    p.set_trainer_stat("정조교", "서울", 22, 4, 8)
    res = build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="backtest")
    assert not p.called("rank_changes") and not p.called("masters")
    assert p.called("trainer_stats")
    pl = res.payload
    assert pl["headlines"] == [] and pl["headline_overflow"] == 0
    assert all(x["badges"] == [] for r in pl["races"] for x in r["runners"])
    assert [r["key"] for r in pl["rules"]] == list(R1.rules)  # 예비 기준은 payload 밖
    assert set(res.extra_rule_results) == {1, 2, 3}
    trainer_1r = res.extra_rule_results[1][0]
    assert trainer_1r["key"] == "trainer" and trainer_1r["status"] == "picked"
    # 박조교(20%) 말 1·3번 → 번호순, 그다음 정조교(18%) 4·6번 중 4번
    assert [(x["mark"], x["chul_no"]) for x in trainer_1r["picks"]] == [(1, 1), (2, 3), (3, 4)]
    assert res.extra_rule_results[3][0]["reason_code"] == "small_field"
    live = build_edition(payload_scenario(), D, GOLDEN_MEET, GOLDEN_NOW, R1)
    # 픽은 live 와 같다 (소식만 꺼짐)
    assert res.picks == live.picks


def test_live_does_not_query_trainer_stats() -> None:
    p = payload_scenario()
    build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1)
    assert not p.called("trainer_stats")
    assert p.called("rank_changes") and p.called("masters")


def test_meta_and_result_shape() -> None:
    res = build_edition(payload_scenario(), D, GOLDEN_MEET, GOLDEN_NOW, R1)
    m = res.meta
    assert m["freeze_at"] == kst(2026, 11, 14, 18, 0)
    assert m["deadline_at"] == kst(2026, 11, 15, 8, 0)
    assert m["entries_batch_at"] == kst(2026, 11, 14, 15, 0)
    assert m["first_post"] == "10:35"
    assert m["history_before"] == H
    assert (m["race_count"], m["runner_count"]) == (3, 15)
    assert (m["rules_version"], m["schema_version"], m["mode"]) == ("r1", 1, "live")
    assert res.warnings == res.payload["edition"]["warnings"]
    assert res.extra_rule_results == {}


def test_first_post_moves_deadline() -> None:
    p = payload_scenario()
    p.metas[(D, GOLDEN_MEET)][1] = p.metas[(D, GOLDEN_MEET)][1].__class__(
        race_no=1, distance=1200, grade="국6", start_time="08:30"
    )
    res = build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1)
    assert res.meta["first_post"] == "08:30"
    assert res.meta["deadline_at"] == kst(2026, 11, 15, 7, 30)
    with pytest.raises(NotPublishable):
        build_edition(p, D, GOLDEN_MEET, kst(2026, 11, 15, 7, 30), R1, enforce_window=True)


def test_bad_arguments() -> None:
    p = payload_scenario()
    with pytest.raises(ValueError):
        build_edition(p, D, "영천", GOLDEN_NOW, R1)
    with pytest.raises(ValueError):
        build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW.replace(tzinfo=None), R1)
    with pytest.raises(ValueError):
        build_edition(p, D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="dry")  # type: ignore[arg-type]


def test_busan_meet_label_normalized() -> None:
    p = FakeProvider()
    p.add_race(D, "부경", 1, distance=1200)
    for chul in range(1, 6):
        p.add_entry(D, "부경", 1, f"B{chul}", chul, rating=60 + chul)
        p.set_master(f"B{chul}", 0)
    res = build_edition(p, D, "부산경남", GOLDEN_NOW, R1)
    assert res.payload["edition"]["meet"] == "부경"
    assert isinstance(build.UNRESOLVED_LOOKBACK_DAYS, int)


def test_fake_provider_satisfies_protocol() -> None:
    from src.racing_form.types import Provider

    assert isinstance(payload_scenario(), Provider)
