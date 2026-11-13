"""데이터 예상단 기준 (계약 §2) 과 주목마 (§2.1). 순수 함수.

- 각 기준은 자격 → 예상 안 함 판정 → (표시 하한) → 정렬 → 상위 3두 mark 1·2·3.
  자격 있는 말이 3두 미만이면 있는 만큼만 표시한다.
- 정렬의 마지막 동점은 출전번호 작은 말 (그래도 같으면 horse_no — 결정성용).
- 비율 비교는 정수 교차곱(a.w·b.n vs b.w·a.n), 표시용 퍼센트는 `(100·w + n//2)//n`. float 없음.
- 경주 활성 N < field.min_active 이면 모든 기준이 `small_field` 로 예상 안 함.
- 문구는 전부 `defn.params["wording"]` 템플릿 (wording.render).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from functools import cmp_to_key
from typing import Any

from . import parse, wording
from .definitions import RuleSetDef
from .features import Entrant
from .types import ConnStat

PICKED = "picked"
NO_PICK = "no_pick"
SMALL_FIELD = "small_field"

#: 동명이인 — 같은 이름에 정규화 기수번호가 이 수 이상이면 기수 기준에서 제외
HOMONYM_MIN_IDS = 2

#: 기준마다 표시하는 최대 두수 (mark 1·2·3)
MAX_MARKS = 3


@dataclass(frozen=True)
class Pick:
    mark: int
    horse_no: str
    chul_no: int
    reason: str

    def to_json(self) -> dict[str, Any]:
        return {
            "mark": self.mark,
            "horse_no": self.horse_no,
            "chul_no": self.chul_no,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class RuleResult:
    """한 기준의 결과. status = picked(picks 1~3) | no_pick(reason_code·reason)."""

    key: str
    status: str
    picks: tuple[Pick, ...] = ()
    reason_code: str | None = None
    reason: str | None = None

    @property
    def is_picked(self) -> bool:
        return self.status == PICKED

    def mark_of(self, horse_no: str) -> int | None:
        for p in self.picks:
            if p.horse_no == horse_no:
                return p.mark
        return None

    def to_json(self) -> dict[str, Any]:
        if self.status == PICKED:
            return {
                "key": self.key,
                "status": PICKED,
                "picks": [p.to_json() for p in self.picks],
            }
        return {
            "key": self.key,
            "status": NO_PICK,
            "reason_code": self.reason_code,
            "reason": self.reason,
        }


@dataclass(frozen=True)
class RaceInputs:
    """한 경주의 기준 입력.

    entrants: 활성 출전마 (출전번호 순). distance: 오늘 경주 거리(모르면 None).
    jockey_stats / trainer_stats: 정규화 이름 → ConnStat (같은 meet, [H−90, H)).
    """

    race_no: int
    meet: str
    distance: int | None
    entrants: tuple[Entrant, ...]
    jockey_stats: Mapping[str, ConnStat] = field(default_factory=dict)
    trainer_stats: Mapping[str, ConnStat] = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.entrants)


# ---------------------------------------------------------------------------
# 공통
# ---------------------------------------------------------------------------


def _cmp(a: int, b: int) -> int:
    return (a > b) - (a < b)


def _cmp_desc(a: int, b: int) -> int:
    return _cmp(b, a)


def _cmp_ratio_desc(aw: int, an: int, bw: int, bn: int) -> int:
    """aw/an 과 bw/bn 을 큰 값 먼저로 비교 (정수 교차곱, an·bn > 0)."""
    return _cmp(bw * an, aw * bn)


def _cmp_number(a: Entrant, b: Entrant) -> int:
    """마지막 동점 — 출전번호 작은 말, 그다음 horse_no (결정성)."""
    c = _cmp(a.runner.chul_no, b.runner.chul_no)
    if c:
        return c
    return (a.runner.horse_no > b.runner.horse_no) - (a.runner.horse_no < b.runner.horse_no)


def is_small_field(race: RaceInputs, defn: RuleSetDef) -> bool:
    return race.n < int(defn.p("field", "min_active"))


def small_field_result(key: str, n: int, defn: RuleSetDef) -> RuleResult:
    m = int(defn.p("field", "min_active"))
    return RuleResult(
        key=key,
        status=NO_PICK,
        reason_code=SMALL_FIELD,
        reason=wording.render(defn, "no_pick_small_field", n=n, m=m),
    )


def _no_pick(defn: RuleSetDef, key: str, code: str, **kw: Any) -> RuleResult:
    return RuleResult(
        key=key, status=NO_PICK, reason_code=code, reason=wording.render(defn, code, **kw)
    )


def _picked(key: str, ordered: Sequence[Entrant], reason: Callable[[Entrant], str]) -> RuleResult:
    picks = tuple(
        Pick(mark=i + 1, horse_no=e.runner.horse_no, chul_no=e.runner.chul_no, reason=reason(e))
        for i, e in enumerate(ordered[:MAX_MARKS])
    )
    return RuleResult(key=key, status=PICKED, picks=picks)


def _min_eligible_half(race: RaceInputs, floor: int) -> int:
    """자격 하한 max(floor, ⌈N/2⌉)."""
    return max(floor, parse.ceil_half(race.n))


# ---------------------------------------------------------------------------
# rating — 출전표 레이팅
# ---------------------------------------------------------------------------


def rank_rating(race: RaceInputs, defn: RuleSetDef) -> RuleResult:
    key = "rating"
    if is_small_field(race, defn):
        return small_field_result(key, race.n, defn)
    m = _min_eligible_half(race, int(defn.p("rules", "rating", "min_eligible_floor")))
    elig = [e for e in race.entrants if e.runner.rating is not None]
    if len(elig) < m:
        return _no_pick(defn, key, "rating_no_pick", e=len(elig), m=m)

    def rating(e: Entrant) -> int:
        assert e.runner.rating is not None
        return e.runner.rating

    ordered = sorted(
        elig, key=cmp_to_key(lambda a, b: _cmp_desc(rating(a), rating(b)) or _cmp_number(a, b))
    )

    def reason(e: Entrant) -> str:
        r = rating(e)
        rank = 1 + sum(1 for x in elig if rating(x) > r)
        tie = any(x is not e and rating(x) == r for x in elig)
        tmpl = "rating_reason_tie" if tie else "rating_reason"
        return wording.render(defn, tmpl, rating=r, n=race.n, rank=rank)

    return _picked(key, ordered, reason)


# ---------------------------------------------------------------------------
# form — 최근 1년 최근 3전
# ---------------------------------------------------------------------------


def _cmp_form(a: Entrant, b: Entrant) -> int:
    fa, fb = a.feat.form, b.feat.form
    c = _cmp_desc(fa.top3, fb.top3) or _cmp_desc(fa.wins, fb.wins)
    if c:
        return c
    la = fa.last_rank if fa.last_rank is not None else 99
    lb = fb.last_rank if fb.last_rank is not None else 99
    c = _cmp(la, lb)
    if c:
        return c
    # 평균 착순 작은 순 (착순 있는 경주만, 교차곱). 착순이 하나도 없으면 뒤로.
    if fa.rank_n and fb.rank_n:
        c = _cmp(fa.rank_sum * fb.rank_n, fb.rank_sum * fa.rank_n)
    else:
        c = _cmp(0 if fa.rank_n else 1, 0 if fb.rank_n else 1)
    return c or _cmp_number(a, b)


def _rank_token(defn: RuleSetDef, rank: int | None) -> str:
    if rank is None:
        return wording.render(defn, "rank_token_none")
    return wording.render(defn, "rank_token", rank=rank)


def rank_form(race: RaceInputs, defn: RuleSetDef) -> RuleResult:
    key = "form"
    if is_small_field(race, defn):
        return small_field_result(key, race.n, defn)
    cfg = defn.p("rules", "form")
    m = _min_eligible_half(race, int(cfg["min_eligible_floor"]))
    elig = [e for e in race.entrants if e.feat.form.window_starts >= int(cfg["min_starts"])]
    if len(elig) < m:
        return _no_pick(defn, key, "form_no_pick_eligible", e=len(elig), m=m)
    shown = [e for e in elig if e.feat.form.top3 >= 1]
    if not shown:
        return _no_pick(defn, key, "form_no_pick_top3")
    ordered = sorted(shown, key=cmp_to_key(_cmp_form))
    arrow = wording.render(defn, "seq_arrow")

    def reason(e: Entrant) -> str:
        f = e.feat.form
        seq = arrow.join(_rank_token(defn, s.rank) for s in f.used)
        return wording.render(defn, "form_reason", k=len(f.used), seq=seq, t=f.top3)

    return _picked(key, ordered, reason)


# ---------------------------------------------------------------------------
# course — 같은 경마장·같은 거리 통산
# ---------------------------------------------------------------------------


def _cmp_course(a: Entrant, b: Entrant) -> int:
    ca, cb = a.feat.course, b.feat.course
    assert ca is not None and cb is not None
    return (
        _cmp_ratio_desc(ca.top3, ca.starts, cb.top3, cb.starts)
        or _cmp_desc(ca.top3, cb.top3)
        or _cmp_desc(ca.wins, cb.wins)
        or _cmp_number(a, b)
    )


def rank_course(race: RaceInputs, defn: RuleSetDef) -> RuleResult:
    key = "course"
    if is_small_field(race, defn):
        return small_field_result(key, race.n, defn)
    if race.distance is None:
        return _no_pick(defn, key, "course_no_pick_distance")
    cfg = defn.p("rules", "course")
    m = int(cfg["min_eligible"])
    elig = [
        e
        for e in race.entrants
        if e.feat.course is not None
        and e.feat.course.distance == race.distance
        and e.feat.course.meet == race.meet
        and e.feat.course.starts >= int(cfg["min_starts"])
    ]
    if len(elig) < m:
        return _no_pick(defn, key, "course_no_pick_eligible", e=len(elig), m=m)
    shown = [e for e in elig if e.feat.course is not None and e.feat.course.top3 >= 1]
    if not shown:
        return _no_pick(defn, key, "course_no_pick_top3")
    ordered = sorted(shown, key=cmp_to_key(_cmp_course))

    def reason(e: Entrant) -> str:
        c = e.feat.course
        assert c is not None
        return wording.render(
            defn,
            "course_reason",
            meet=race.meet,
            distance=race.distance,
            s=c.starts,
            t=c.top3,
            w=c.wins,
        )

    return _picked(key, ordered, reason)


# ---------------------------------------------------------------------------
# jockey / trainer — 최근 90일 같은 경마장
# ---------------------------------------------------------------------------


def _cmp_conn(a: tuple[Entrant, ConnStat], b: tuple[Entrant, ConnStat]) -> int:
    sa, sb = a[1], b[1]
    return (
        _cmp_ratio_desc(sa.wins, sa.starts, sb.wins, sb.starts)
        or _cmp_ratio_desc(sa.top3, sa.starts, sb.top3, sb.starts)
        or _cmp_desc(sa.starts, sb.starts)
        or _cmp_number(a[0], b[0])
    )


def _rank_conn(
    race: RaceInputs,
    defn: RuleSetDef,
    *,
    key: str,
    name_of: Callable[[Entrant], str | None],
    stats: Mapping[str, ConnStat],
    min_starts: int,
    min_eligible: int,
    check_homonym: bool,
    no_pick_key: str,
    reason_key: str,
    count_kw: str,
) -> RuleResult:
    if is_small_field(race, defn):
        return small_field_result(key, race.n, defn)
    elig: list[tuple[Entrant, ConnStat]] = []
    for e in race.entrants:
        name = name_of(e)
        st = stats.get(name) if name else None
        if st is None or st.starts < min_starts:
            continue
        if check_homonym and st.distinct_ids >= HOMONYM_MIN_IDS:
            continue
        elig.append((e, st))
    if len(elig) < min_eligible:
        return _no_pick(defn, key, no_pick_key, e=len(elig), m=min_eligible)
    ordered = sorted(elig, key=cmp_to_key(_cmp_conn))
    stat_of = {id(e): st for e, st in elig}

    def reason(e: Entrant) -> str:
        st = stat_of[id(e)]
        kw = {count_kw: st.starts}
        return wording.render(
            defn,
            reason_key,
            name=name_of(e),
            meet=race.meet,
            wins=st.wins,
            pct=parse.pct(st.wins, st.starts),
            **kw,
        )

    return _picked(key, [e for e, _ in ordered], reason)


def rank_jockey(race: RaceInputs, defn: RuleSetDef) -> RuleResult:
    """실제 기수의 같은 meet [H−90, H) 기승 20회 이상, 동명이인(기수번호 2개 이상) 제외."""
    cfg = defn.p("rules", "jockey")
    return _rank_conn(
        race,
        defn,
        key="jockey",
        name_of=lambda e: e.runner.jockey_name,
        stats=race.jockey_stats,
        min_starts=int(cfg["min_rides"]),
        min_eligible=int(cfg["min_eligible"]),
        check_homonym=True,
        no_pick_key="jockey_no_pick",
        reason_key="jockey_reason",
        count_kw="rides",
    )


def rank_trainer(race: RaceInputs, defn: RuleSetDef) -> RuleResult:
    """(예비) 출전표 조교사의 같은 meet [H−90, H) 출주 20회 이상."""
    cfg = defn.p("rules", "trainer")
    return _rank_conn(
        race,
        defn,
        key="trainer",
        name_of=lambda e: e.runner.trainer_name,
        stats=race.trainer_stats,
        min_starts=int(cfg["min_starts"]),
        min_eligible=int(cfg["min_eligible"]),
        check_homonym=False,
        no_pick_key="trainer_no_pick",
        reason_key="trainer_reason",
        count_kw="starts",
    )


RULE_FUNCS: dict[str, Callable[[RaceInputs, RuleSetDef], RuleResult]] = {
    "rating": rank_rating,
    "form": rank_form,
    "course": rank_course,
    "jockey": rank_jockey,
    "trainer": rank_trainer,
}


def evaluate(key: str, race: RaceInputs, defn: RuleSetDef) -> RuleResult:
    try:
        fn = RULE_FUNCS[key]
    except KeyError as e:
        raise KeyError(f"unknown racing_form rule: {key!r}") from e
    return fn(race, defn)


def evaluate_all(keys: Sequence[str], race: RaceInputs, defn: RuleSetDef) -> tuple[RuleResult, ...]:
    return tuple(evaluate(k, race, defn) for k in keys)


# ---------------------------------------------------------------------------
# §2.1 주목마
# ---------------------------------------------------------------------------

CONSENSUS_PICKED = "picked"
CONSENSUS_SPLIT = "split"
CONSENSUS_INSUFFICIENT = "insufficient"
CONSENSUS_SMALL_FIELD = "small_field"


@dataclass(frozen=True)
class ConsensusPick:
    mark: int
    horse_no: str
    chul_no: int
    votes: int
    marks: tuple[tuple[str, int], ...]  # (기준, 받은 기호) — 기준 고정 순서
    reasons: tuple[str, ...]
    reasons_more: int

    def to_json(self) -> dict[str, Any]:
        return {
            "mark": self.mark,
            "horse_no": self.horse_no,
            "chul_no": self.chul_no,
            "votes": self.votes,
            "marks": dict(self.marks),
            "reasons": list(self.reasons),
            "reasons_more": self.reasons_more,
        }


@dataclass(frozen=True)
class ConsensusResult:
    status: str
    active_rules: int
    min_votes: int
    picks: tuple[ConsensusPick, ...] = ()

    def mark_of(self, horse_no: str) -> int | None:
        for p in self.picks:
            if p.horse_no == horse_no:
                return p.mark
        return None

    def to_json(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "active_rules": self.active_rules,
            "min_votes": self.min_votes,
            "picks": [p.to_json() for p in self.picks],
        }


def consensus(
    results: Sequence[RuleResult], defn: RuleSetDef, *, small_field: bool
) -> ConsensusResult:
    """발행 기준(defn.rules) 결과 → 주목마.

    A = picked 인 발행 기준 수. small_field → "small_field", A < min_active_rules → "insufficient".
    후보 = v ≥ min_votes. 정렬 v↓ → mark1 수↓ → mark2 수↓ → 번호↑, 상위 max_picks 두 → mark 1·2.
    후보 0 → "split". reasons = 고른 기준들의 근거를 (받은 mark↑ → 기준 고정 순서)
    앞 max_reasons 개.
    """
    cfg = defn.p("consensus")
    min_votes = int(cfg["min_votes"])
    order = {k: i for i, k in enumerate(defn.rules)}
    picked = sorted(
        (r for r in results if r.is_picked and r.key in order), key=lambda r: order[r.key]
    )
    a = len(picked)
    if small_field:
        return ConsensusResult(CONSENSUS_SMALL_FIELD, a, min_votes)
    if a < int(cfg["min_active_rules"]):
        return ConsensusResult(CONSENSUS_INSUFFICIENT, a, min_votes)

    marks: dict[str, list[tuple[str, int, str]]] = {}
    chul: dict[str, int] = {}
    for r in picked:
        for p in r.picks:
            marks.setdefault(p.horse_no, []).append((r.key, p.mark, p.reason))
            chul[p.horse_no] = p.chul_no

    def sort_key(horse_no: str) -> tuple[int, int, int, int, str]:
        got = marks[horse_no]
        return (
            -len(got),
            -sum(1 for _, m, _ in got if m == 1),
            -sum(1 for _, m, _ in got if m == 2),
            chul[horse_no],
            horse_no,
        )

    cands = sorted((h for h, got in marks.items() if len(got) >= min_votes), key=sort_key)
    top = cands[: int(cfg["max_picks"])]
    if not top:
        return ConsensusResult(CONSENSUS_SPLIT, a, min_votes)

    max_reasons = int(cfg["max_reasons"])
    out: list[ConsensusPick] = []
    for i, horse_no in enumerate(top):
        got = sorted(marks[horse_no], key=lambda x: (x[1], order[x[0]]))
        reasons = tuple(reason for _, _, reason in got)
        out.append(
            ConsensusPick(
                mark=i + 1,
                horse_no=horse_no,
                chul_no=chul[horse_no],
                votes=len(got),
                marks=tuple((k, m) for k, m, _ in sorted(got, key=lambda x: order[x[0]])),
                reasons=reasons[:max_reasons],
                reasons_more=max(0, len(reasons) - max_reasons),
            )
        )
    return ConsensusResult(CONSENSUS_PICKED, a, min_votes, tuple(out))
