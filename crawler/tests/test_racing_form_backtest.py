"""경마지 과거 시험 — 집계·보고서·정책 (DB 없음). DB 경로는 test_racing_form_cli.py 가 본다."""

from __future__ import annotations

import json
from datetime import date, timedelta
from fractions import Fraction
from typing import Any

import pytest
from racing_form_fakes import FakeProvider, kst

from src.racing_form import backtest, definitions, payload, settle
from src.racing_form.backtest import (
    Agreement,
    BacktestError,
    Cell,
    HoldoutExists,
    RaceScore,
    RuleAgg,
    Section,
    Tally,
)

R1 = definitions.get("r1")
D = date(2026, 10, 10)  # 토
H = D - timedelta(days=1)
NOW = kst(2026, 11, 14, 13, 0)


def small_world() -> FakeProvider:
    """서울 1R 6두 — 다섯 기준이 모두 예상을 내는 세계 + D 결과·배당."""
    p = FakeProvider(entries_updated_at=kst(2026, 10, 9, 15))
    p.add_race(D, "서울", 1, distance=1200, start_time="11:00")
    jockeys = ["갑기수", "을기수", "병기수", "정기수", "무기수", "기기수"]
    for c in range(1, 7):
        hn = f"BT{c:02d}"
        p.add_entry(D, "서울", 1, hn, c, rating=60 + c, jockey=jockeys[c - 1],
                    trainer=f"조교{c % 3}")
        for k in range(3):  # 서울 1200m 3전 (최근 1년)
            p.add_result(H - timedelta(days=14 * (k + 1)), "서울", 2, hn, ((c + k) % 6) + 1,
                         distance=1200, chul_no=c, time=f"7{c}.{k}")
        p.set_jockey_stat(jockeys[c - 1], "서울", 30, 2 + c, 8 + c)
    for t in range(3):
        p.set_trainer_stat(f"조교{t}", "서울", 25, 2 + t, 6 + t)
    # D 결과 — 출전번호 6 이 1착 … 1 이 6착, 배당은 6번이 최저
    for c in range(1, 7):
        p.add_result(D, "서울", 1, f"BT{c:02d}", 7 - c, chul_no=c, time=f"7{2 + 6 - c}.0")
        p.add_dividend(D, "서울", 1, str(c), f"{c + 1}.5" if c != 6 else "1.8")
    return p


def outcome(winners: list[str], placed: list[str], starters: int, *,
            favorites: list[str] | None = None, pop: dict[str, int] | None = None,
            status: str = settle.OFFICIAL, non_starters: list[str] | None = None
            ) -> settle.Outcome:
    return settle.Outcome(race_no=1, status=status, starters=starters, winners=winners,
                          placed=placed, non_starters=non_starters or [],
                          favorites=favorites or [], pop_ranks=pop or {})


# ---------------------------------------------------------------------------
# 보조
# ---------------------------------------------------------------------------


def test_month_chunks_split_calendar_months() -> None:
    assert backtest.month_chunks(date(2025, 1, 15), date(2025, 3, 2)) == [
        (date(2025, 1, 15), date(2025, 1, 31)),
        (date(2025, 2, 1), date(2025, 2, 28)),
        (date(2025, 3, 1), date(2025, 3, 2)),
    ]
    assert backtest.month_chunks(date(2025, 12, 30), date(2026, 1, 2)) == [
        (date(2025, 12, 30), date(2025, 12, 31)), (date(2026, 1, 1), date(2026, 1, 2))]
    assert backtest.month_chunks(date(2025, 5, 5), date(2025, 5, 5)) == [
        (date(2025, 5, 5), date(2025, 5, 5))]


def test_normalize_meets() -> None:
    assert backtest.normalize_meets(None) == ("서울", "부경", "제주")
    got = backtest.normalize_meets(["제주", "부산경남", "서울", "제주"])
    assert got == ("서울", "부경", "제주")
    with pytest.raises(BacktestError):
        backtest.normalize_meets(["영천"])


def test_substitutions_replace_each_published_rule_with_reserve() -> None:
    subs = backtest.substitutions(R1)
    assert [(s.replaced, s.by, s.rules) for s in subs] == [
        ("rating", "trainer", ("trainer", "form", "course", "jockey")),
        ("form", "trainer", ("rating", "trainer", "course", "jockey")),
        ("course", "trainer", ("rating", "form", "trainer", "jockey")),
        ("jockey", "trainer", ("rating", "form", "course", "trainer")),
    ]
    assert [s.key for s in subs][0] == "rating>trainer"


def test_settle_clock_is_after_void_deadline_and_deterministic() -> None:
    clock = backtest.settle_clock(D, R1)
    assert clock == kst(2026, 10, 17)  # D+7 00:00 KST — 실행 시각과 무관
    assert backtest.batch_clock(D) == kst(2026, 10, 9, 15)


# ---------------------------------------------------------------------------
# 집계
# ---------------------------------------------------------------------------


def test_cell_counts_and_exact_fractions() -> None:
    cell = Cell()
    o1 = outcome(["A"], ["A", "B", "C"], 10, favorites=["A", "B"], pop={"A": 1, "B": 1, "C": 3})
    o2 = outcome(["X", "Y"], ["X", "Y", "Z"], 12, favorites=["Z"], pop={"C": 4})  # 동착
    assert cell.add("A", o1) == "win"
    assert cell.add("C", o2) == "miss"
    assert cell.add("C", outcome([], [], 0, status=settle.RACE_VOID)) == "void"
    assert cell.add("N", outcome(["A"], ["A"], 8, non_starters=["N"])) == "void"
    assert (cell.n, cell.wins, cell.top3, cell.voids) == (2, 1, 1, 2)
    assert cell.random_win == Fraction(1, 10) + Fraction(2, 12)
    assert cell.random_top3 == Fraction(3, 10) + Fraction(3, 12)
    assert cell.fav_races == 2
    assert cell.fav_win == Fraction(1, 2) + Fraction(0, 1)
    assert cell.fav_top3 == Fraction(2, 2) + Fraction(1, 1)
    assert (cell.pop_n, cell.pop_sum) == (2, 1 + 4)
    js = cell.to_json("rating", 1)
    assert js["random_win"] == [4, 15] and js["fav_win"] == [1, 2] and js["fav_top3"] == [2, 1]
    backtest.assert_no_float(js)


def test_rule_agg_and_agreement() -> None:
    agg = RuleAgg()
    agg.add([])  # 예상 안 함 — 세지 않음
    agg.add(["void", "void"])
    agg.add(["miss", "win"])
    assert (agg.races_picked, agg.races_n, agg.races_any_win) == (2, 1, 1)
    assert agg.to_json("form", 5)["participation"] == [2, 5]

    ag = Agreement(("rating", "form", "jockey"))
    base: dict[str, Any] = dict(race_date=D, meet="서울", race_no=1, small_field=False,
                                outcome=None, combos={})
    ag.add_race(RaceScore(**base, picks={"rating": ((1, "A"),), "form": ((1, "A"), (2, "B")),
                                          "jockey": ((1, "B"),)}))
    ag.add_race(RaceScore(**base, picks={"rating": ((1, "C"),), "form": ((1, "D"),)}))
    got = {(x["a"], x["b"]): (x["agree"], x["both"]) for x in ag.to_json()}
    assert got == {("rating", "form"): (1, 2), ("rating", "jockey"): (0, 1),
                   ("form", "jockey"): (0, 1)}


def test_section_counts_consensus_mark1_only_and_unsettled() -> None:
    sec = Section(R1)
    o = outcome(["H2"], ["H2", "H1", "H3"], 9)
    sec.add_race(RaceScore(race_date=D, meet="서울", race_no=1, small_field=False, outcome=o,
                           picks={"rating": ((1, "H1"), (2, "H2"), (3, "H9")),
                                  "consensus": ((1, "H2"), (2, "H1"))},
                           combos={"rating>trainer": ((1, "H3"),)}))
    sec.add_race(RaceScore(race_date=D, meet="서울", race_no=2, small_field=True, outcome=None,
                           picks={}, combos={}))
    js = sec.to_json()
    assert (js["races"], js["small_field"], js["unsettled"]) == (1, 1, 1)
    cells = {(c["rule_key"], c["mark"]): c for c in js["cells"]}
    assert (cells[("rating", 1)]["n"], cells[("rating", 1)]["top3"]) == (1, 1)
    assert cells[("rating", 2)]["wins"] == 1 and cells[("rating", 3)]["top3"] == 0
    assert ("consensus", 2) not in cells  # 주목마는 1순위만
    assert (cells[("consensus", 1)]["n"], cells[("consensus", 1)]["wins"]) == (1, 1)
    sub = next(s for s in js["substitutions"] if s["replaced"] == "rating")
    assert (sub["cell"]["n"], sub["cell"]["top3"], sub["rule"]["races_picked"]) == (1, 1, 1)
    rules_ = {r["rule_key"]: r for r in js["rules"]}
    assert rules_["rating"]["participation"] == [1, 1]
    assert rules_["form"]["participation"] == [0, 1]


# ---------------------------------------------------------------------------
# 호 채점 (FakeProvider — 발행·정산과 같은 코드)
# ---------------------------------------------------------------------------


def test_score_edition_builds_backtest_and_settles() -> None:
    p = small_world()
    (rs,) = backtest.score_edition(p, D, "서울", R1)
    assert rs.outcome is not None and rs.outcome.status == settle.OFFICIAL
    assert rs.outcome.winners == ["BT06"] and rs.outcome.favorites == ["BT06"]
    assert rs.picks["rating"][0] == (1, "BT06")  # 레이팅 최고 66
    assert {"rating", "form", "course", "jockey", "trainer"} <= set(rs.picks)
    assert set(rs.combos) == {s.key for s in backtest.substitutions(R1)}
    # 소식·마스터는 조회하지 않는다 (as-of 불가 — backtest 모드)
    assert not p.called("rank_changes") and not p.called("masters")
    assert not p.called("results_exist")


def test_build_report_no_float_deterministic_and_baselines() -> None:
    def run() -> dict[str, Any]:
        p = small_world()
        tally = Tally(R1, ("서울",))
        tally.add_edition(D, "서울", backtest.score_edition(p, D, "서울", R1))
        tally.durations_ms.extend([5, 9, 7])
        return backtest.build_report(tally, label="dev", d_from=D, d_to=D, total_ms=21)

    a, b = run(), run()
    assert payload.canonical_json(a) == payload.canonical_json(b)
    backtest.assert_no_float(a)
    assert all(type(v) is int for v in a["counts"].values())  # 정수만
    assert a["report_version"] == 1 and a["definition_sha256"] == definitions.definition_sha256(R1)
    assert a["counts"] == {"editions": 1, "editions_failed": 0, "races": 1, "settled": 1,
                           "races_void": 0, "small_field": 0, "unsettled": 0}
    assert a["runtime_ms"] == {"total": 21, "editions": 3, "edition_max": 9, "edition_median": 7}
    cells = {(c["rule_key"], c["mark"]): c for c in a["overall"]["cells"]}
    honmei = cells[("rating", 1)]
    assert (honmei["n"], honmei["wins"], honmei["top3"]) == (1, 1, 1)
    assert honmei["random_win"] == [1, 6] and honmei["random_top3"] == [1, 2]
    assert (honmei["fav_races"], honmei["fav_win"]) == (1, [1, 1])
    assert set(a["by_meet"]) == {"서울"} and a["errors"] == []
    assert len(a["agreement"]) == 10  # 기준 5개 → 쌍 10개
    text = backtest.render_text(a)
    assert "과거 시험 — dev" in text and "주목마(1순위): 선정" in text and "회수율" in text


def test_tally_errors_are_redacted_and_capped() -> None:
    tally = Tally(R1, ("서울",))
    for i in range(backtest.MAX_ERRORS_IN_REPORT + 3):
        tally.add_error(D, "서울", RuntimeError(f"boom serviceKey=SECRET{i} \n 줄바꿈"))
    rep = backtest.build_report(tally, label="dev", d_from=D, d_to=D, total_ms=0)
    assert rep["counts"]["editions_failed"] == backtest.MAX_ERRORS_IN_REPORT + 3
    assert len(rep["errors"]) == backtest.MAX_ERRORS_IN_REPORT
    assert "SECRET" not in json.dumps(rep, ensure_ascii=False)
    assert "\n" not in rep["errors"][0]["error"]


def test_assert_no_float_rejects_float() -> None:
    with pytest.raises(ValueError, match="float"):
        backtest.assert_no_float({"a": [1, {"b": 0.5}]})


# ---------------------------------------------------------------------------
# 정책 (DB 에 닿기 전에 거부)
# ---------------------------------------------------------------------------


def _no_db() -> Any:
    raise AssertionError("DB 에 접근하면 안 된다")


@pytest.mark.parametrize(
    ("kw", "msg"),
    [
        (dict(label="prod"), "label"),
        (dict(label="dev", save=True), "dev"),
        (dict(label="holdout", save=False), "holdout"),
        (dict(label="dev", public=True), "public"),
        (dict(label="dev", d_to=NOW.date()), "어제"),
        (dict(label="dev", d_from=D + timedelta(days=1), d_to=D), "거꾸로"),
    ],
)
def test_run_backtest_policy_errors(kw: dict[str, Any], msg: str) -> None:
    args: dict[str, Any] = dict(d_from=D, d_to=D, label="dev", save=False, public=False)
    args.update(kw)
    with pytest.raises(BacktestError, match=msg):
        backtest.run_backtest(_no_db, R1, args["d_from"], args["d_to"], None, args["label"], NOW,
                              save=args["save"], public=args["public"])
    with pytest.raises(ValueError):
        backtest.run_backtest(_no_db, R1, D, D, None, "dev", NOW.replace(tzinfo=None))


def test_holdout_refused_before_any_computation(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(backtest, "holdout_row", lambda conn, sha: {"id": 7, "sha": sha})

    def no_compute(*a: Any, **k: Any) -> Any:
        calls.append("compute")
        raise AssertionError("계산하면 안 된다")

    monkeypatch.setattr(backtest, "compute_report", no_compute)
    with pytest.raises(HoldoutExists, match="id 7"):
        backtest.run_backtest(lambda: None, R1, D, D, None, "holdout", NOW, save=True)
    assert calls == []


def test_holdout_saves_before_returning(monkeypatch: pytest.MonkeyPatch) -> None:
    order: list[str] = []
    monkeypatch.setattr(backtest, "holdout_row", lambda conn, sha: None)
    monkeypatch.setattr(backtest, "compute_report",
                        lambda *a, **k: order.append("compute") or {"report_version": 1})
    monkeypatch.setattr(backtest, "save_report",
                        lambda *a, **k: order.append(f"save:{k['public']}:{k['code_rev']}") or 1)
    rep = backtest.run_backtest(lambda: None, R1, D, D, ["서울"], "holdout", NOW, save=True,
                                public=True, code_rev="abc")
    assert rep == {"report_version": 1}
    assert order == ["compute", "save:True:abc"]


def test_compute_report_reopens_transaction_after_db_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """한 호의 DB 오류(트랜잭션 abort)는 그 호만 실패로 — 새 READ ONLY 트랜잭션으로 이어 간다."""
    from contextlib import contextmanager

    from sqlalchemy.exc import DBAPIError

    from src.racing_form.types import CalendarRow

    opened: list[str] = []
    rolled_back: list[str] = []

    @contextmanager
    def fake_ro(factory: Any, **kw: Any) -> Any:
        assert kw == {"statement_timeout_ms": backtest.STATEMENT_TIMEOUT_MS,
                      "lock_timeout_ms": backtest.LOCK_TIMEOUT_MS}
        opened.append("tx")
        try:
            yield object()
        except BaseException:
            rolled_back.append("rollback")
            raise

    days = [D, D + timedelta(days=1), D + timedelta(days=7)]

    class FakeBP:
        def __init__(self, sql: Any) -> None:
            pass

        def calendar(self, lo: date, hi: date, meets: tuple[str, ...]) -> list[CalendarRow]:
            return [CalendarRow(d, "서울", 1, None) for d in days if lo <= d <= hi]

    def fake_score(bp: Any, d: date, meet: str, defn: Any) -> list[RaceScore]:
        if d == days[0]:
            raise DBAPIError("SELECT 1", {}, Exception("canceling statement due to timeout"))
        if d == days[1]:
            raise KeyError("bad row")
        return []

    monkeypatch.setattr(backtest.queries, "read_only_provider", fake_ro)
    monkeypatch.setattr(backtest, "BacktestProvider", FakeBP)
    monkeypatch.setattr(backtest, "score_edition", fake_score)
    ticks = iter(range(100))
    rep = backtest.compute_report(lambda: None, R1, D, D + timedelta(days=7), ["서울"],
                                  label="dev", timer=lambda: next(ticks) / 1000)
    assert rep["counts"]["editions_failed"] == 2 and rep["counts"]["editions"] == 1
    assert [e["race_date"] for e in rep["errors"]] == [days[0].isoformat(), days[1].isoformat()]
    # 달력 1 + 첫 호(DB 오류로 롤백) 1 + 이어 가는 트랜잭션 1 — 일반 예외는 트랜잭션을 버리지 않는다
    assert len(opened) == 3 and rolled_back == ["rollback"]
    assert rep["runtime_ms"]["editions"] == 3
