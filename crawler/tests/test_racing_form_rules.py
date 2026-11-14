"""경마지 기준 r1 (계약 §2) + 주목마 (§2.1) — 자격 경계·표시 하한·동명이인·거리 모름·정렬·동점."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from racing_form_fakes import hist_row, make_entrant

from src.racing_form import definitions, rules
from src.racing_form.features import Entrant
from src.racing_form.rules import NO_PICK, PICKED, Pick, RaceInputs, RuleResult
from src.racing_form.types import ConnStat

R1 = definitions.get("r1")
D = date(2026, 11, 15)
H = date(2026, 11, 14)


def ago(n: int) -> date:
    return H - timedelta(days=n)


def form_hist(hn: str, ranks: list[int | None], *, distance: int = 2300) -> list:
    """최근 성적용 이력 (1년 안, 오래된 → 최근, 7일 간격). None = 순위 없음(기록 있음)."""
    n = len(ranks)
    return [
        hist_row(hn, ago(7 * (n - i)), rk, distance=distance, race_no=i + 1)
        for i, rk in enumerate(ranks)
    ]


def course_hist(hn: str, ranks: list[int], *, distance: int = 1200, meet: str = "서울") -> list:
    """거리 적성용 이력 (1년보다 전 — 최근 성적에 섞이지 않게)."""
    n = len(ranks)
    return [
        hist_row(hn, ago(500 + 7 * (n - i)), rk, distance=distance, meet=meet, race_no=i + 1)
        for i, rk in enumerate(ranks)
    ]


def ent(chul: int, **kw: object) -> Entrant:
    hn = f"H{chul:02d}"
    history = []
    if "form" in kw:
        history += form_hist(hn, kw.pop("form"))  # type: ignore[arg-type]
    if "course" in kw:
        history += course_hist(hn, kw.pop("course"))  # type: ignore[arg-type]
    distance = kw.pop("distance", 1200)
    return make_entrant(chul, R1, horse_no=hn, history=history, distance=distance, **kw)  # type: ignore[arg-type]


def race(
    entrants: list[Entrant],
    *,
    distance: int | None = 1200,
    jockeys: dict[str, tuple[int, int, int, int]] | None = None,
    trainers: dict[str, tuple[int, int, int]] | None = None,
) -> RaceInputs:
    return RaceInputs(
        race_no=1,
        meet="서울",
        distance=distance,
        entrants=tuple(entrants),
        jockey_stats={n: ConnStat(n, *v) for n, v in (jockeys or {}).items()},
        trainer_stats={n: ConnStat(n, *v) for n, v in (trainers or {}).items()},
    )


def picks(rr: RuleResult) -> list[tuple[int, int]]:
    assert rr.status == PICKED, rr
    return [(p.mark, p.chul_no) for p in rr.picks]


def no_pick(rr: RuleResult) -> tuple[str | None, str | None]:
    assert rr.status == NO_PICK, rr
    return rr.reason_code, rr.reason


# ---------------------------------------------------------------------------
# small_field
# ---------------------------------------------------------------------------


def test_small_field_boundary() -> None:
    four = race([ent(i, rating=60 + i) for i in range(1, 5)])
    for key in R1.rules + R1.backtest_extra_rules:
        rr = rules.evaluate(key, four, R1)
        assert no_pick(rr) == ("small_field", "출전 4두 — 5두 미만이라 예상 안 함")
    assert rules.consensus(rules.evaluate_all(R1.rules, four, R1), R1, small_field=True).status == (
        "small_field"
    )
    five = race([ent(i, rating=60 + i) for i in range(1, 6)])
    assert rules.evaluate("rating", five, R1).status == PICKED


# ---------------------------------------------------------------------------
# rating
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("n", "m"), [(5, 3), (6, 3), (7, 4), (8, 4), (9, 5), (12, 6)])
def test_rating_eligibility_boundary_max3_ceil_half(n: int, m: int) -> None:
    ok = race([ent(i, rating=(50 + i) if i <= m else None) for i in range(1, n + 1)])
    assert rules.rank_rating(ok, R1).status == PICKED
    short = race([ent(i, rating=(50 + i) if i < m else None) for i in range(1, n + 1)])
    assert no_pick(rules.rank_rating(short, R1)) == (
        "rating_no_pick",
        f"레이팅이 있는 말이 {m - 1}두뿐 (최소 {m}두)",
    )


def test_rating_sort_reason_and_tie_wording() -> None:
    rr = rules.rank_rating(
        race([ent(1, rating=70), ent(2, rating=75), ent(3, rating=75), ent(4), ent(5, rating=70)]),
        R1,
    )
    assert picks(rr) == [(1, 2), (2, 3), (3, 1)]
    assert [p.reason for p in rr.picks] == [
        "레이팅 75 · 출전 5두 중 공동 1위(번호순)",
        "레이팅 75 · 출전 5두 중 공동 1위(번호순)",
        "레이팅 70 · 출전 5두 중 공동 3위(번호순)",
    ]
    rr = rules.rank_rating(race([ent(i, rating=60 + i) for i in range(1, 7)]), R1)
    assert picks(rr) == [(1, 6), (2, 5), (3, 4)]
    assert rr.picks[2].reason == "레이팅 64 · 출전 6두 중 3위"


# ---------------------------------------------------------------------------
# form
# ---------------------------------------------------------------------------


def test_form_eligibility_two_starts_and_boundary() -> None:
    # N=7 → 최소 4두. 1전뿐인 말은 자격 없음
    base = [ent(1, form=[1, 2]), ent(2, form=[3, 1]), ent(3, form=[2, 2]), ent(4, form=[1])]
    rr = rules.rank_form(race(base + [ent(5), ent(6), ent(7)]), R1)
    assert no_pick(rr) == ("form_no_pick_eligible", "최근 1년 2번 이상 뛴 말이 3두뿐 (최소 4두)")
    rr = rules.rank_form(race(base[:3] + [ent(4, form=[9, 9]), ent(5), ent(6), ent(7)]), R1)
    assert picks(rr) == [(1, 2), (2, 1), (3, 3)]


def test_form_display_floor_and_no_top3() -> None:
    rr = rules.rank_form(
        race(
            [
                ent(1, form=[4, 5]),
                ent(2, form=[1, 6, 4]),
                ent(3, form=[7, 3]),
                ent(4, form=[6, 8]),
                ent(5),
            ]
        ),
        R1,
    )
    assert picks(rr) == [(1, 2), (2, 3)]  # 3착 이내가 있는 말만 — 2두만 표시
    assert [p.reason for p in rr.picks] == [
        "최근 3전 1착→6착→4착 (3착 이내 1번)",
        "최근 2전 7착→3착 (3착 이내 1번)",
    ]
    rr = rules.rank_form(
        race([ent(1, form=[1, 5, 6, 7]), ent(2, form=[4, 4]), ent(3, form=[5, 9]), ent(4), ent(5)]),
        R1,
    )
    assert no_pick(rr) == ("form_no_pick_top3", "최근 3전에서 3착 안에 든 말이 없음")


def test_form_sort_keys_cross_multiplied_average() -> None:
    rr = rules.rank_form(
        race(
            [
                ent(1, form=[4, 3, 2]),  # t2 w0 last2 avg 9/3
                ent(2, form=[2, 5, 2]),  # t2 w0 last2 avg 9/3 → 번호
                ent(3, form=[None, 3, 2]),  # t2 w0 last2 avg 5/2 (착순 있는 경주만)
                ent(4, form=[6, 1, 3]),  # t2 w1
                ent(5, form=[7, 2, 3]),  # t2 w0 last3
                ent(6, form=[1, 9]),  # t1
            ]
        ),
        R1,
    )
    assert picks(rr) == [(1, 4), (2, 3), (3, 1)]
    assert rr.picks[1].reason == "최근 3전 순위 없음→3착→2착 (3착 이내 2번)"


def test_form_last_rank_none_sorts_as_99() -> None:
    rr = rules.rank_form(
        race([ent(1, form=[1, None]), ent(2, form=[1, 9]), ent(3, form=[2, 8]), ent(4), ent(5)]),
        R1,
    )
    # 1·2 모두 t1 w1 — 직전 착순 None(99) 인 1번이 9착인 2번보다 뒤
    assert picks(rr) == [(1, 2), (2, 1), (3, 3)]


# ---------------------------------------------------------------------------
# course
# ---------------------------------------------------------------------------


def test_course_distance_unknown() -> None:
    rr = rules.rank_course(race([ent(i, course=[1, 1, 1]) for i in range(1, 6)], distance=None), R1)
    assert no_pick(rr) == ("course_no_pick_distance", "거리 정보 없음")


def test_course_eligibility_three_starts_three_horses() -> None:
    two = race(
        [
            ent(1, course=[1, 2, 3]),
            ent(2, course=[2, 1, 4, 5]),
            ent(3, course=[1, 1]),
            ent(4),
            ent(5),
        ]
    )
    assert no_pick(rules.rank_course(two, R1)) == (
        "course_no_pick_eligible",
        "이 경마장·거리에서 3번 이상 뛴 말이 2두뿐 (최소 3두)",
    )
    three = race(
        [
            ent(1, course=[1, 2, 3]),
            ent(2, course=[2, 1, 4, 5]),
            ent(3, course=[1, 1, 9]),
            ent(4),
            ent(5),
        ]
    )
    assert rules.rank_course(three, R1).status == PICKED


def test_course_sort_rate_cross_multiplied_then_top3_wins() -> None:
    rr = rules.rank_course(
        race(
            [
                ent(1, course=[1, 2, 5]),  # 2/3
                ent(2, course=[1, 1, 2, 4, 6]),  # 3/5
                ent(3, course=[3, 2, 6, 7, 1, 2]),  # 4/6 = 2/3, 3착 이내 수 많음
                ent(4, course=[2, 3, 1, 9, 8, 7]),  # 3/6
                ent(5, course=[5, 6, 7]),  # 0 — 표시 안 함
                ent(6, course=[1, 1]),  # 2전 — 자격 없음
            ]
        ),
        R1,
    )
    assert picks(rr) == [(1, 3), (2, 1), (3, 2)]
    assert rr.picks[0].reason == "서울 1200m 6번 중 3착 이내 4번 (1착 1번)"


def test_course_ignores_other_meet_and_no_top3() -> None:
    other = [hist_row("H05", ago(600), 1, meet="부경", distance=1200)]
    rr = rules.rank_course(
        race(
            [
                ent(1, course=[4, 5, 6]),
                ent(2, course=[7, 8, 9, 4]),
                ent(3, course=[5, 5, 5]),
                ent(4, course=[1, 1]),
                make_entrant(5, R1, horse_no="H05", history=other),
            ]
        ),
        R1,
    )
    assert no_pick(rr) == ("course_no_pick_top3", "이 경마장·거리에서 3착 안에 든 말이 없음")


# ---------------------------------------------------------------------------
# jockey / trainer
# ---------------------------------------------------------------------------


def test_jockey_20_rides_homonym_and_null_mix() -> None:
    names = ["김가람", "이나래", "박다온", "최라온", "정마루", "한바다"]
    rr = rules.rank_jockey(
        race(
            [ent(i + 1, jockey=n) for i, n in enumerate(names)],
            jockeys={
                "김가람": (19, 5, 9, 1),  # 19기승 — 자격 없음
                "이나래": (20, 3, 8, 1),  # 20기승 경계 — 자격
                "박다온": (40, 10, 15, 2),  # 동명이인(번호 2개) — 제외
                "최라온": (30, 6, 10, 1),
                "정마루": (25, 5, 12, 0),  # 번호가 모두 NULL → 0 — 동명이인 아님
            },
        ),
        R1,
    )
    assert picks(rr) == [(1, 5), (2, 4), (3, 2)]
    assert [p.reason for p in rr.picks] == [
        "정마루 기수 · 최근 90일 서울 25번 중 5승 (승률 20%)",
        "최라온 기수 · 최근 90일 서울 30번 중 6승 (승률 20%)",
        "이나래 기수 · 최근 90일 서울 20번 중 3승 (승률 15%)",
    ]


def test_jockey_not_enough_and_missing_name() -> None:
    rr = rules.rank_jockey(
        race(
            [ent(1, jockey="갑기수"), ent(2, jockey="을기수"), ent(3), ent(4), ent(5)],
            jockeys={"갑기수": (30, 3, 9, 1), "을기수": (20, 1, 2, 1)},
        ),
        R1,
    )
    assert no_pick(rr) == (
        "jockey_no_pick",
        "최근 90일 이 경마장에서 20번 이상 탄 기수의 말이 2두뿐 (최소 3두)",
    )


def test_jockey_tie_chain() -> None:
    names = ["윤소리", "장한결", "임새벽", "오누리", "서다솜"]
    rr = rules.rank_jockey(
        race(
            [ent(i + 1, jockey=n) for i, n in enumerate(names)],
            jockeys={
                "윤소리": (20, 4, 8, 1),
                "장한결": (40, 8, 16, 1),
                "임새벽": (30, 6, 12, 1),
                "오누리": (20, 4, 8, 1),
                "서다솜": (50, 5, 20, 1),
            },
        ),
        R1,
    )
    # 승률·3착 이내율 동률 → 기승 수 많은 순 → 번호
    assert picks(rr) == [(1, 2), (2, 3), (3, 1)]


def test_jockey_top3_rate_breaks_win_rate_tie() -> None:
    rr = rules.rank_jockey(
        race(
            [ent(1, jockey="가"), ent(2, jockey="나"), ent(3, jockey="다"), ent(4), ent(5)],
            jockeys={"가": (30, 6, 10, 1), "나": (25, 5, 12, 1), "다": (20, 1, 10, 1)},
        ),
        R1,
    )
    assert picks(rr) == [(1, 2), (2, 1), (3, 3)]


def test_trainer_rule_no_homonym_check() -> None:
    rr = rules.rank_trainer(
        race(
            [
                ent(1, trainer="박조교"),
                ent(2, trainer="최조교"),
                ent(3, trainer="정조교"),
                ent(4),
                ent(5),
            ],
            trainers={"박조교": (40, 6, 15), "최조교": (20, 4, 7), "정조교": (19, 9, 9)},
        ),
        R1,
    )
    assert no_pick(rr)[0] == "trainer_no_pick"
    rr = rules.rank_trainer(
        race(
            [
                ent(1, trainer="박조교"),
                ent(2, trainer="최조교"),
                ent(3, trainer="정조교"),
                ent(4),
                ent(5),
            ],
            trainers={"박조교": (40, 6, 15), "최조교": (20, 4, 7), "정조교": (21, 2, 9)},
        ),
        R1,
    )
    assert picks(rr) == [(1, 2), (2, 1), (3, 3)]
    assert rr.picks[0].reason == "최조교 조교사 · 최근 90일 서울 20번 중 4승 (승률 20%)"


# ---------------------------------------------------------------------------
# §2.1 주목마
# ---------------------------------------------------------------------------


def rr_pick(key: str, *chuls: int) -> RuleResult:
    return RuleResult(
        key,
        PICKED,
        tuple(Pick(i + 1, f"H{c:02d}", c, f"{key}-{c}") for i, c in enumerate(chuls)),
    )


def rr_none(key: str) -> RuleResult:
    return RuleResult(key, NO_PICK, reason_code=f"{key}_no_pick", reason="x")


def test_consensus_a2_insufficient() -> None:
    c = rules.consensus(
        [
            rr_pick("rating", 1, 2, 3),
            rr_pick("form", 1, 2, 3),
            rr_none("course"),
            rr_none("jockey"),
        ],
        R1,
        small_field=False,
    )
    assert (c.status, c.active_rules, c.picks) == ("insufficient", 2, ())


def test_consensus_a3_all_three_pick() -> None:
    c = rules.consensus(
        [
            rr_pick("rating", 1, 2, 3),
            rr_pick("form", 1, 4, 2),
            rr_none("course"),
            rr_pick("jockey", 1, 3, 5),
        ],
        R1,
        small_field=False,
    )
    assert (c.status, c.active_rules) == ("picked", 3)
    assert [(p.mark, p.chul_no, p.votes) for p in c.picks] == [(1, 1, 3)]
    p = c.picks[0]
    assert dict(p.marks) == {"rating": 1, "form": 1, "jockey": 1}
    assert p.reasons == ("rating-1", "form-1") and p.reasons_more == 1


def test_consensus_a4_v3_sort_and_max_two() -> None:
    c = rules.consensus(
        [
            rr_pick("rating", 3, 1, 2),
            rr_pick("form", 1, 3, 5),
            rr_pick("course", 1, 2, 3),
            rr_pick("jockey", 2, 1, 4),
        ],
        R1,
        small_field=False,
    )
    # 1: v4 · 2: v3 (◎1 ○1) · 3: v3 (◎1 ○1) → 번호순으로 2 → 최대 2두라 3은 빠짐
    assert [(p.mark, p.chul_no, p.votes) for p in c.picks] == [(1, 1, 4), (2, 2, 3)]
    one, two = c.picks
    assert one.reasons == ("form-1", "course-1") and one.reasons_more == 2
    assert dict(one.marks) == {"rating": 2, "form": 1, "course": 1, "jockey": 2}
    assert [k for k, _ in one.marks] == ["rating", "form", "course", "jockey"]
    assert two.reasons == ("jockey-2", "course-2") and two.reasons_more == 1


def test_consensus_mark_counts_break_vote_ties() -> None:
    c = rules.consensus(
        [
            rr_pick("rating", 1, 2, 3),
            rr_pick("form", 2, 1, 3),
            rr_pick("course", 3, 2, 1),
            rr_pick("jockey", 4, 5, 6),
        ],
        R1,
        small_field=False,
    )
    # 1·2·3 모두 v3 · ◎ 1개씩 — ○: 2번 2개, 1번 1개, 3번 0개 → 2, 1
    assert [(p.mark, p.chul_no) for p in c.picks] == [(1, 2), (2, 1)]


def test_consensus_split_small_field_and_unpublished_rules_ignored() -> None:
    split = rules.consensus(
        [
            rr_pick("rating", 1, 2, 3),
            rr_pick("course", 4, 5, 6),
            rr_pick("jockey", 7, 8, 1),
            rr_none("form"),
        ],
        R1,
        small_field=False,
    )
    assert (split.status, split.active_rules, split.picks) == ("split", 3, ())
    small = rules.consensus([rr_none(k) for k in R1.rules], R1, small_field=True)
    assert (small.status, small.active_rules) == ("small_field", 0)
    # 예비 기준(trainer)은 A·v 에 들어가지 않는다
    c = rules.consensus(
        [
            rr_pick("rating", 1, 2, 3),
            rr_pick("form", 1, 2, 3),
            rr_none("course"),
            rr_none("jockey"),
            rr_pick("trainer", 1, 2, 3),
        ],
        R1,
        small_field=False,
    )
    assert (c.status, c.active_rules) == ("insufficient", 2)
