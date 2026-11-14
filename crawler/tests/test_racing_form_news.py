"""경마지 말 소식 (계약 §3) — 임계값 경계·데뷔 vs 기록 없음·처음 탐·배지 3·헤드라인 6 상한."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from racing_form_fakes import hist_row, make_entrant

from src.racing_form import definitions, news, wording
from src.racing_form.news import Badge, RaceNews
from src.racing_form.types import MasterRow, RaceMeta, RankChange

R1 = definitions.get("r1")
D = date(2026, 11, 15)
H = date(2026, 11, 14)


def days_before_d(n: int) -> date:
    return D - timedelta(days=n)


def badges(
    *,
    history: list | None = None,
    rating: int | None = None,
    jockey: str | None = "갑기수",
    trainer: str | None = None,
    wg_budam: str | None = "54.0",
    distance: int | None = 1200,
    rank_change: RankChange | None = None,
    master: MasterRow | None = None,
    **jc: str | None,
) -> dict[str, Badge]:
    e = make_entrant(
        1,
        R1,
        horse_no="A",
        history=history or [],
        rating=rating,
        jockey=jockey,
        trainer=trainer,
        wg_budam=wg_budam,
        distance=distance,
        **jc,
    )
    got = news.runner_badges(
        e, d=D, meet="서울", distance=distance, rank_change=rank_change, master=master, defn=R1
    )
    kinds = [b.kind for b in got]
    assert len(kinds) == len(set(kinds))
    return {b.kind: b for b in got}


def last_at(n: int, rank: int | None = 3, **kw: object) -> list:
    """D − n 일에 마지막 출주 1회."""
    return [hist_row("A", days_before_d(n), rank, jockey="갑기수", **kw)]  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 간격
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("days", "kind"),
    [
        (89, None),
        (90, "layoff"),
        (180, "layoff"),
        (14, "quick_return"),
        (15, None),
        (2, "quick_return"),
    ],
)
def test_layoff_and_quick_return_boundaries(days: int, kind: str | None) -> None:
    got = badges(history=last_at(days))
    assert ("layoff" in got) == (kind == "layoff")
    assert ("quick_return" in got) == (kind == "quick_return")


def test_layoff_text() -> None:
    got = badges(history=last_at(112, rank=3))
    assert (
        got["layoff"].text
        == f"112일 만의 출전 (직전 {days_before_d(112).month}월 {days_before_d(112).day}일 3착)"
    )
    got = badges(history=last_at(100, rank=None, time="75.0"))
    assert got["layoff"].text.endswith("순위 없음)")
    assert badges(history=last_at(9))["quick_return"].text == "9일 만에 다시 출전"


# ---------------------------------------------------------------------------
# 레이팅 · 거리 · 부담
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("prev", "now", "delta"), [(64, 66, None), (64, 67, 3), (64, 61, -3), (64, 68, 4)]
)
def test_rating_change_threshold(prev: int, now: int, delta: int | None) -> None:
    got = badges(history=last_at(30, hr_rating=prev), rating=now)
    if delta is None:
        assert "rating_change" not in got
        return
    b = got["rating_change"]
    assert b.delta == delta
    sign = "▲" if delta > 0 else "▼"
    assert b.text == f"레이팅 {sign}{abs(delta)} ({prev}→{now})"
    assert b.to_json() == {"kind": "rating_change", "text": b.text, "delta": delta}


def test_rating_high_needs_two_rated_starts() -> None:
    one = [hist_row("A", days_before_d(30), 2, hr_rating=60)]
    assert "rating_high" not in badges(history=one, rating=70)
    two = one + [hist_row("A", days_before_d(20), 2, hr_rating=66)]
    assert badges(history=two, rating=67)["rating_high"].text == "레이팅 개인 최고"
    assert "rating_high" not in badges(history=two, rating=66)  # 같으면 경신 아님


@pytest.mark.parametrize(
    ("prev", "now", "changed"), [(1200, 1399, False), (1200, 1400, True), (1400, 1200, True)]
)
def test_distance_change_threshold(prev: int, now: int, changed: bool) -> None:
    got = badges(history=last_at(30, distance=prev), distance=now)
    assert ("distance_change" in got) is changed
    if changed:
        assert got["distance_change"].text == f"거리 {prev}m→{now}m"


def test_distance_first() -> None:
    got = badges(history=last_at(30, distance=1200), distance=1400)
    assert got["distance_first"].text == "1400m 첫 출전"
    assert "distance_first" not in badges(history=last_at(30, distance=1400), distance=1400)
    assert "distance_first" not in badges(history=[], distance=1400)  # 출주 ≥ 1 일 때만
    assert "distance_first" not in badges(history=last_at(30, distance=1200), distance=None)


@pytest.mark.parametrize(
    ("prev", "now", "delta"), [("56.0", "54.1", None), ("56.0", "54.0", -20), ("53.0", "55.5", 25)]
)
def test_budam_change_threshold(prev: str, now: str, delta: int | None) -> None:
    got = badges(history=last_at(30, wg_budam=prev), wg_budam=now)
    if delta is None:
        assert "budam_change" not in got
        return
    assert got["budam_change"].delta == delta
    assert got["budam_change"].text == f"부담 {prev}→{now}kg"


def test_budam_change_uses_effective_weight_after_jockey_change() -> None:
    got = badges(
        history=last_at(30, wg_budam="56.0"),
        wg_budam="56.0",
        jc_before="갑기수",
        jc_after="을기수",
        jc_weight_before="56.0",
        jc_weight_after="54.0",
    )
    assert got["budam_change"].delta == -20
    assert got["jockey_change"].text == "기수 교체 갑기수→을기수 · 부담 56.0→54.0kg"


# ---------------------------------------------------------------------------
# 데뷔 · 기록 없음 · 처음 탐 · 기수 교체 · 등급 · 조교사 · 경마장 · 연승
# ---------------------------------------------------------------------------


def test_debut_vs_no_record() -> None:
    assert badges(master=MasterRow("A", 0))["debut"].text == "데뷔전"
    assert badges(master=MasterRow("A", 5))["no_record"].text == "mal.kr 수집 기록 없음"
    assert "no_record" in badges(master=None)
    assert "no_record" in badges(master=MasterRow("A", None))
    # 미출주 행만 있는 말 = 이력 0 (출주만 센다)
    scratched = [hist_row("A", days_before_d(30), None, time="-")]
    assert "debut" in badges(history=scratched, master=MasterRow("A", 0))
    # 이력이 있으면 둘 다 아님
    got = badges(history=last_at(30), master=MasterRow("A", 0))
    assert "debut" not in got and "no_record" not in got


def test_first_pair() -> None:
    got = badges(history=last_at(30), jockey="을기수")
    assert got["first_pair"].text == "을기수 기수가 이 말을 처음 탐"
    assert "first_pair" not in badges(history=last_at(30), jockey="갑기수")
    assert "first_pair" not in badges(history=[], jockey="을기수")  # 출주 ≥ 1
    assert "first_pair" not in badges(history=last_at(30), jockey=None)
    # 실제 기수(기수 변경 after) 기준
    got = badges(history=last_at(30), jockey="갑기수", jc_before="갑기수", jc_after="병기수")
    assert got["first_pair"].text == "병기수 기수가 이 말을 처음 탐"


def test_jockey_change_text_variants() -> None:
    got = badges(jc_before="한교체", jc_after="이과천", jc_reason="기수 부상")
    assert got["jockey_change"].text == "기수 교체 한교체→이과천 (기수 부상)"
    got = badges(
        jc_before="한교체", jc_after="이과천", jc_weight_before="55.0", jc_weight_after="55.0"
    )
    assert got["jockey_change"].text == "기수 교체 한교체→이과천"  # 부담 같으면 생략
    assert "jockey_change" not in badges()


def test_same_jockey_change_row_has_no_badge_or_headline() -> None:
    """기수변경 행의 전·후 이름이 같으면("A→A") 배지·헤드라인 없음 — payload 기록은 그대로."""
    kw = {"jc_before": " 한교체", "jc_after": "한교체 ", "jc_reason": "착오 정정",
          "jc_weight_before": "55.0", "jc_weight_after": "54.0"}
    e = make_entrant(1, R1, horse_no="A", jockey="한교체", **kw)
    got = news.runner_badges(
        e, d=D, meet="서울", distance=1200, rank_change=None, master=MasterRow("A", 3), defn=R1
    )
    assert "jockey_change" not in {b.kind for b in got}
    # payload 의 runner.jockey_change 는 남는다 (이름은 정규화, 부담 변화 포함)
    assert e.runner.jockey_change is not None
    assert e.runner.jockey_change.to_json() == {
        "before": "한교체", "after": "한교체", "reason": "착오 정정",
        "weight_before_tenths": 550, "weight_after_tenths": 540,
    }
    heads, overflow = news.build_headlines([_race_news(1, [(e, tuple(got))])], R1)
    assert all(h.kind != "jockey_change" for h in heads) and overflow == 0
    # 한쪽 이름이 없거나 다르면 기존대로 배지
    assert badges(jc_before=None, jc_after="한교체")["jockey_change"].text == "기수 교체 -→한교체"
    assert badges(jc_before="한교체", jc_after="이과천")["jockey_change"].text == (
        "기수 교체 한교체→이과천")
    assert news.is_same_jockey(e.runner.jockey_change)


def test_class_change_window_and_direction() -> None:
    hist = last_at(40)
    last_date = days_before_d(40)
    after = RankChange("A", last_date + timedelta(days=1), "국5", "국6")
    assert badges(history=hist, rank_change=after)["class_change"].text == "국5→국6 강급 후 첫 출전"
    up = RankChange("A", D, "국 4등급", "국3등급")
    assert (
        badges(history=hist, rank_change=up)["class_change"].text
        == "국 4등급→국3등급 승급 후 첫 출전"
    )
    other = RankChange("A", D, "국5", "혼5")
    assert badges(history=hist, rank_change=other)["class_change"].text.endswith(
        "등급 변경 후 첫 출전"
    )
    same_day = RankChange("A", last_date, "국5", "국6")  # 마지막 출주일 < st_date 여야 함
    assert "class_change" not in badges(history=hist, rank_change=same_day)
    future = RankChange("A", D + timedelta(days=1), "국5", "국6")
    assert "class_change" not in badges(history=hist, rank_change=future)
    # 이력 없으면 st_date ≤ D 만
    assert "class_change" in badges(history=[], rank_change=after)


def test_latest_rank_change_picks_latest_on_or_before_d() -> None:
    rows = [
        RankChange("A", D - timedelta(days=50), "국6", "국5"),
        RankChange("A", D - timedelta(days=5), "국5", "국4"),
        RankChange("A", D + timedelta(days=3), "국4", "국3"),
        RankChange("B", D, "국1", "국2"),
    ]
    got = news.latest_rank_change(rows, "A", D)
    assert got is not None and got.after_rank == "국4"
    assert news.latest_rank_change(rows, "C", D) is None


def test_trainer_change_meet_move() -> None:
    hist = last_at(30, trainer=" 박조교 ", meet="부경")
    got = badges(history=hist, trainer="최조교")
    assert got["trainer_change"].text == "조교사 변경 박조교→최조교"
    assert got["meet_move"].text == "경마장 이동 (직전 부경)"
    got = badges(history=last_at(30, trainer="박조교", meet="부산경남"), trainer="박조교")
    assert "trainer_change" not in got
    assert got["meet_move"].text == "경마장 이동 (직전 부경)"
    assert "trainer_change" not in badges(history=last_at(30, trainer=None), trainer="최조교")
    assert "meet_move" not in badges(history=last_at(30, meet="서울"))


def test_win_streak_and_last_win() -> None:
    two = [hist_row("A", days_before_d(40), 1), hist_row("A", days_before_d(20), 1)]
    assert badges(history=two)["win_streak"].text == "2연승 중"
    one = [hist_row("A", days_before_d(40), 2), hist_row("A", days_before_d(20), 1)]
    got = badges(history=one)
    assert "win_streak" not in got
    d20 = days_before_d(20)
    assert got["last_win"].text == f"직전 경주 1착 ({d20.month}월 {d20.day}일)"
    assert not {"win_streak", "last_win"} & set(badges(history=[hist_row("A", d20, 2)]))


# ---------------------------------------------------------------------------
# 배지 우선순위·상한
# ---------------------------------------------------------------------------


def test_badge_priority_order_and_cap_three() -> None:
    hist = [
        hist_row(
            "A",
            days_before_d(200),
            1,
            distance=1000,
            hr_rating=60,
            trainer="박조교",
            wg_budam="56.0",
            meet="부경",
        ),
    ]
    got = news.runner_badges(
        make_entrant(
            1,
            R1,
            horse_no="A",
            history=hist,
            rating=70,
            jockey="을기수",
            trainer="최조교",
            wg_budam="53.0",
            jc_before="갑기수",
            jc_after="을기수",
        ),
        d=D,
        meet="서울",
        distance=1400,
        rank_change=RankChange("A", D, "국5", "국6"),
        master=MasterRow("A", 3),
        defn=R1,
    )
    kinds = [b.kind for b in got]
    priority = R1.p("news", "badge_priority")
    assert kinds == sorted(kinds, key=priority.index)
    assert kinds[:3] == ["jockey_change", "class_change", "layoff"]
    visible, more = news.split_badges(got, R1)
    assert [b.kind for b in visible] == kinds[:3]
    assert [b.kind for b in more] == kinds[3:]
    assert len(more) >= 5
    for b in got:
        assert wording.is_clean(b.text), b


# ---------------------------------------------------------------------------
# 헤드라인
# ---------------------------------------------------------------------------


def _race_news(race_no: int, entrants_badges: list, stakes: dict | None = None) -> RaceNews:
    return RaceNews(race_no=race_no, stakes=stakes, distance=1400, runners=tuple(entrants_badges))


def _with_layoff(chul: int, days: int, race_no: int = 1):
    e = make_entrant(
        chul,
        R1,
        race_no=race_no,
        history=[hist_row(f"H{race_no:02d}{chul:02d}", days_before_d(days), 2)],
    )
    b = news.runner_badges(
        e, d=D, meet="서울", distance=1200, rank_change=None, master=None, defn=R1
    )
    return e, tuple(b)


def test_layoff_headline_min_180_and_max_two() -> None:
    runners = [
        _with_layoff(1, 179),
        _with_layoff(2, 180),
        _with_layoff(3, 300),
        _with_layoff(4, 200),
    ]
    heads, overflow = news.build_headlines([_race_news(1, runners)], R1)
    layoffs = [h for h in heads if h.kind == "layoff"]
    assert [h.chul_no for h in layoffs] == [2, 3]  # 180일 이상, 경주·번호순 앞 2개
    assert overflow == 0


def test_headline_priority_cap_six_and_overflow() -> None:
    def jc(chul: int, race_no: int):
        e = make_entrant(chul, R1, race_no=race_no, jc_before="갑", jc_after="을")
        b = news.runner_badges(
            e, d=D, meet="서울", distance=1200, rank_change=None, master=MasterRow("x", 0), defn=R1
        )
        return e, tuple(b)

    races = [
        _race_news(2, [jc(1, 2), jc(2, 2)], stakes={"name": "가을배", "grade": "G3"}),
        _race_news(1, [jc(3, 1), jc(1, 1)]),
        _race_news(3, [jc(1, 3)], stakes={"name": "대상경주", "grade": None}),
    ]
    heads, overflow = news.build_headlines(races, R1)
    assert len(heads) == 6
    assert [(h.kind, h.race_no, h.chul_no) for h in heads] == [
        ("stakes", 2, None),
        ("stakes", 3, None),
        ("jockey_change", 1, 1),
        ("jockey_change", 1, 3),
        ("jockey_change", 2, 1),
        ("jockey_change", 2, 2),
    ]
    # 후보: stakes 2 + 기수 교체 5 + 데뷔 요약 1 = 8 → 6 + 2
    assert overflow == 2
    assert heads[0].text == "2R 가을배 (G3, 1400m)"
    assert heads[1].text == "3R 대상경주 (1400m)"
    assert heads[2].to_json() == {
        "kind": "jockey_change",
        "race_no": 1,
        "chul_no": 1,
        "horse_no": "H0101",
        "text": "기수 교체 갑→을",
    }


def test_summary_headlines() -> None:
    def runner(chul: int, **kw: object):
        e = make_entrant(chul, R1, **kw)  # type: ignore[arg-type]
        b = news.runner_badges(
            e, d=D, meet="서울", distance=1200, rank_change=None, master=MasterRow("x", 0), defn=R1
        )
        return e, tuple(b)

    moved = [hist_row("H0102", days_before_d(30), 4, meet="제주", trainer="갑조교")]
    races = [_race_news(1, [runner(1), runner(2, history=moved, trainer="을조교")])]
    heads, overflow = news.build_headlines(races, R1)
    assert [(h.kind, h.text) for h in heads] == [
        ("summary_trainer_change", "조교사 변경 1두"),
        ("summary_debut", "데뷔 1두"),
        ("summary_meet_move", "경마장 이동 1두"),
    ]
    assert all(h.race_no is None and h.horse_no is None for h in heads)
    assert overflow == 0


def test_win_streak_headline_needs_three() -> None:
    def streak(chul: int, n: int):
        hn = f"H01{chul:02d}"
        hist = [hist_row(hn, days_before_d(10 * (k + 1)), 1) for k in range(n)]
        e = make_entrant(chul, R1, history=hist)
        b = news.runner_badges(
            e, d=D, meet="서울", distance=1200, rank_change=None, master=None, defn=R1
        )
        return e, tuple(b)

    heads, _ = news.build_headlines([_race_news(1, [streak(1, 2), streak(2, 3)])], R1)
    assert [(h.kind, h.chul_no, h.text) for h in heads if h.kind == "win_streak"] == [
        ("win_streak", 2, "3연승 중")
    ]


# ---------------------------------------------------------------------------
# 대상경주
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("grade", "name", "plan", "expected"),
    [
        ("G1", None, None, True),
        ("L", "부산일보배", None, True),
        ("대상", None, None, True),
        ("국6", "일반경주", None, False),
        ("국1", "그랑프리 대상경주", None, True),
        ("국1", "오너스컵", "오너스컵", True),
        (None, None, None, False),
        ("혼3", None, "  ", False),
    ],
)
def test_is_stakes_matches_web(
    grade: str | None, name: str | None, plan: str | None, expected: bool
) -> None:
    assert news.is_stakes_race(grade, name, plan) is expected


def test_stakes_info_and_text() -> None:
    meta = RaceMeta(9, race_name=" 부산일보배 ", grade="L", distance=1600)
    info = news.stakes_info(meta)
    assert info == {"name": "부산일보배", "grade": "L"}
    assert news.stakes_text(9, info, 1600, R1) == "9R 부산일보배 (L, 1600m)"
    plan = RaceMeta(5, race_name=None, grade="국1", plan_name="오너스컵", plan_grade="G3")
    assert news.stakes_info(plan) == {"name": "오너스컵", "grade": "G3"}
    assert (
        news.stakes_text(5, {"name": "오너스컵", "grade": None}, 1200, R1) == "5R 오너스컵 (1200m)"
    )
    assert news.stakes_text(5, {"name": "오너스컵", "grade": "G3"}, None, R1) == "5R 오너스컵 (G3)"
    assert news.stakes_info(RaceMeta(1, grade="국6")) is None
    assert news.stakes_info(None) is None
