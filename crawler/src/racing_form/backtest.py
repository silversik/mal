"""경마지 과거 시험(backtest) — 결과표 기반 명단(Q1b)으로 지난 경주일을 다시 만들어 채점한다.

계약: docs/spec/racing-form-contract.md §10 (보고서 v1). 계획 §5.5 (사전 등록·출시 게이트).

- `BacktestProvider` — `types.Provider` 구현. 그날의 출전명단·달력은 race_results 의 **출주**
  (§1.1: rank ≥ 1 또는 기록 > 0)에서 만든다 (Q1b): 레이팅 = 결과 raw hrRating, 기수·조교사 =
  결과 컬럼(실제 기수), 부담 = raw wgBudam, 출전번호 = raw chulNo, 기수변경 없음, updated_at =
  batch_at = 그날의 고정값(D−1 15:00 KST). 이력·기수 집계·정산 입력 등 나머지는 SqlProvider 에
  그대로 맡긴다 (이력은 같은 H 컷 race_date < H — build_edition 이 넘기는 h).
  · 달력도 결과에서 만든다 — 지난 경주일에는 race_entries 가 없어 Q0(races ∩ race_entries)가 비기
    때문이다.
  · 경주 거리: races.distance 가 비어 있으면(결과로만 만든 races 행) 결과 raw rcDist 로 채운다
    (경주 거리는 경주 전에 공표되는 값이라 as-of 누수가 아니다).
- `run_backtest(conn, defn, d_from, d_to, meets, label, now, save, public, code_rev)` → 보고서 dict.
  · 월 단위로 끊어 READ ONLY 트랜잭션(statement_timeout·lock_timeout = SET LOCAL)에서 읽는다.
  · 발행·정산과 같은 코드: `build.build_edition(mode="backtest")` (소식 끔·예비 기준 함께) +
    `settle.settle_race`.
  · 보고서에는 **정수와 [분자, 분모] 쌍만** 들어간다 (float 없음). 무작위·1번 인기 기대값은 정확한
    분수(Fraction)를 기약분수 쌍으로 싣는다.
  · label="dev": 아무것도 쓰지 않는다 (save 불가). label="holdout": save 필수. 같은 정의 해시의
    holdout 행이 이미 있으면 **계산하지 않고** 거부 → 계산 → INSERT (report_sha256 은 SQL 에서,
    is_public 은 이때 정함 — 추가 전용이라 나중에 바꿀 수 없다) → 그 뒤에 반환(출력).
  · holdout 은 한 호라도 실패하면(DB 오류·예상 밖 예외) 그 자리에서 멈추고 **저장·출력하지 않는다**
    (HoldoutIncomplete) — 일시적인 인프라 오류가 정의 해시당 1회인 holdout 을 써 버리지 않게.
    원인을 고친 뒤 다시 실행할 수 있다. dev 는 실패한 호를 세고 계속 간다.
  · ensure_rule_set 은 부르지 않는다 (기준 정의 등록은 발행 잡만).
- 현재 시각을 읽지 않는다 — now 는 인자. 실행 시간 통계만 단조 타이머(기본 time.perf_counter,
  주입 가능)로 잰다.
"""

from __future__ import annotations

import dataclasses
import time
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from fractions import Fraction
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError, IntegrityError

from ..redact import redact
from . import build, definitions, parse, payload, queries, rules, schedule, settle
from .definitions import CONSENSUS_KEY, RULE_LABELS, RuleSetDef
from .queries import SqlProvider, first_post_of, meet_aliases
from .settle import Outcome
from .types import (
    CalendarRow,
    ConnStat,
    DividendRow,
    EntryRow,
    HistoryRow,
    MasterRow,
    RaceMeta,
    RankChange,
    ResultRow,
)

REPORT_VERSION = 1
LABELS: tuple[str, ...] = ("dev", "holdout")

#: 과거 시험 조회 타임아웃 (ms) — 문장마다 (SET LOCAL)
STATEMENT_TIMEOUT_MS = 60_000
LOCK_TIMEOUT_MS = 5_000

#: 보고서에 싣는 오류 메시지 수 상한 (총수는 counts.editions_failed)
MAX_ERRORS_IN_REPORT = 20
_ERROR_TEXT_MAX = 300

#: Q1b 명단의 배치 시각 = D−1 15:00 KST (stale 판정이 일어나지 않게 모든 행에 같은 값)
BATCH_MINUTE = 15 * 60

SessionFactory = Callable[[], AbstractContextManager[Any]]
Timer = Callable[[], float]


class BacktestError(RuntimeError):
    """과거 시험을 시작할 수 없음 (입력·정책 위반)."""


class HoldoutExists(BacktestError):
    """같은 정의 해시의 holdout 보고서가 이미 있다 — 계산하지 않고 거부."""


class HoldoutIncomplete(BacktestError):
    """holdout 계산 중 실패한 호가 있다 — 저장·출력하지 않는다 (다시 실행할 수 있다).

    failures: ({race_date, meet, error}, ...) — 오류 문구는 마스킹·앞 300자.
    결과 수치는 담지 않는다.
    """

    def __init__(self, failures: Sequence[Mapping[str, Any]]) -> None:
        self.failures = tuple(dict(f) for f in failures)
        where = "; ".join(f"{f['race_date']} {f['meet']} {f['error']}" for f in self.failures)
        super().__init__(
            f"holdout 과거 시험 중 실패한 호 {len(self.failures)}개 — 저장하지 않았다 — "
            f"원인 해결 후 다시 실행할 수 있다 (정의 해시당 1회 규칙은 저장된 보고서에만 걸린다): "
            f"{where}"
        )


# ---------------------------------------------------------------------------
# Q1b SQL
# ---------------------------------------------------------------------------

#: 출주 판정 (§1.1) — Python features.classify_start 와 같다 (기록은 round(초×10) > 0)
_STARTED = "COALESCE(rr.rank >= 1 OR round(rr.record_time * 10) > 0, FALSE)"

_Q1B_CALENDAR = text(
    f"""
    SELECT s.race_date,
           s.meet,
           s.race_count,
           COALESCE((
               SELECT array_remove(array_agg(NULLIF(btrim(r.start_time), '')), NULL)
                 FROM races r
                WHERE r.race_date = s.race_date
                  AND r.meet = s.meet
           ), ARRAY[]::text[]) AS start_times
      FROM (
            SELECT rr.race_date, rr.meet, COUNT(DISTINCT rr.race_no)::int AS race_count
              FROM race_results rr
             WHERE rr.race_date BETWEEN :d_from AND :d_to
               AND rr.meet = ANY(CAST(:meets AS text[]))
               AND {_STARTED}
             GROUP BY rr.race_date, rr.meet
           ) s
     ORDER BY s.race_date, s.meet
    """
)

_Q1B_ENTRIES = text(
    f"""
    SELECT rr.race_date,
           rr.meet,
           rr.race_no,
           rr.horse_no,
           rr.raw ->> 'chulNo'                     AS raw_chul_no,
           NULLIF(btrim(rr.raw ->> 'hrName'), '')  AS horse_name,
           NULLIF(btrim(rr.jockey_name), '')       AS jockey_name,
           NULLIF(btrim(rr.trainer_name), '')      AS trainer_name,
           NULLIF(btrim(rr.raw ->> 'age'), '')     AS age,
           NULLIF(btrim(rr.raw ->> 'sex'), '')     AS sex,
           rr.raw ->> 'hrRating'                   AS raw_hr_rating,
           rr.raw ->> 'wgBudam'                    AS raw_wg_budam
      FROM race_results rr
     WHERE rr.race_date = :d
       AND rr.meet = ANY(CAST(:meets AS text[]))
       AND {_STARTED}
     ORDER BY rr.race_no, rr.horse_no
    """
)

# 경주 거리 보충 — 결과 raw rcDist (races.distance 가 비어 있는 지난 경주용)
_Q1B_DISTANCES = text(
    """
    SELECT rr.race_no, MAX(NULLIF(btrim(rr.raw ->> 'rcDist'), '')) AS raw_rc_dist
      FROM race_results rr
     WHERE rr.race_date = :d
       AND rr.meet = ANY(CAST(:meets AS text[]))
     GROUP BY rr.race_no
     ORDER BY rr.race_no
    """
)

_HOLDOUT_ROW = text(
    """
    SELECT id, report_sha256, is_public, computed_at
      FROM racing_form_backtests
     WHERE label = 'holdout'
       AND definition_sha256 = :sha
    """
)

_INSERT_BACKTEST = text(
    """
    INSERT INTO racing_form_backtests (
        candidate_version, definition_sha256, label, period_from, period_to, meets,
        report, report_sha256, code_rev, is_public, computed_at)
    VALUES (
        :candidate_version, :definition_sha256, :label, :period_from, :period_to,
        CAST(:meets AS text[]),
        CAST(:report AS jsonb),
        encode(sha256(convert_to(CAST(:report AS jsonb)::text, 'UTF8')), 'hex'),
        :code_rev, :is_public, :computed_at)
    RETURNING id, report_sha256
    """
)


def _rows(conn: Any, sql: Any, params: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return list(conn.execute(sql, dict(params)).mappings().all())


def _aliases(meets: Iterable[str]) -> list[str]:
    return sorted({a for m in meets for a in meet_aliases(m)})


# ---------------------------------------------------------------------------
# provider
# ---------------------------------------------------------------------------


def batch_clock(d: date) -> datetime:
    """Q1b 명단의 updated_at = batch_at (D−1 15:00 KST, 고정)."""
    return schedule.at_kst(d - timedelta(days=1), BATCH_MINUTE)


class BacktestProvider:
    """`types.Provider` — 명단·달력은 결과표(Q1b), 나머지는 SqlProvider."""

    def __init__(self, sql: SqlProvider) -> None:
        self.sql = sql
        self.conn = sql.conn

    # ------------------------------------------------------------------ Q1b
    def calendar(self, d_from: date, d_to: date, meets: tuple[str, ...]) -> list[CalendarRow]:
        rows = _rows(
            self.conn,
            _Q1B_CALENDAR,
            {"d_from": d_from, "d_to": d_to, "meets": _aliases(meets)},
        )
        return [
            CalendarRow(
                race_date=r["race_date"],
                meet=r["meet"],
                race_count=int(r["race_count"]),
                first_post=first_post_of(r["start_times"] or []),
            )
            for r in rows
        ]

    def entries(self, d: date, meet: str) -> list[EntryRow]:
        rows = _rows(self.conn, _Q1B_ENTRIES, {"d": d, "meets": meet_aliases(meet)})
        ts = batch_clock(d)
        return [
            EntryRow(
                race_date=r["race_date"],
                meet=r["meet"],
                race_no=int(r["race_no"]),
                horse_no=r["horse_no"],
                chul_no=parse.parse_pos_int(r["raw_chul_no"]),
                horse_name=r["horse_name"],
                jockey_name=r["jockey_name"],
                trainer_name=r["trainer_name"],
                age=r["age"],
                sex=r["sex"],
                rating=None,  # 결과표 레이팅만 — features.entry_rating 이 raw 로 읽는다
                raw_hr_rating=r["raw_hr_rating"],
                raw_wg_budam=r["raw_wg_budam"],
                updated_at=ts,
                batch_at=ts,
            )
            for r in rows
        ]

    def race_meta(self, d: date, meet: str) -> list[RaceMeta]:
        """SqlProvider Q6 + 거리 보충 (races 행이 없거나 거리가 비면 결과 raw rcDist)."""
        metas = {m.race_no: m for m in self.sql.race_meta(d, meet)}
        dist = {
            int(r["race_no"]): r["raw_rc_dist"]
            for r in _rows(self.conn, _Q1B_DISTANCES, {"d": d, "meets": meet_aliases(meet)})
        }
        out: dict[int, RaceMeta] = dict(metas)
        for race_no, raw in dist.items():
            m = out.get(race_no)
            if m is None:
                out[race_no] = RaceMeta(race_no=race_no, raw_rc_dist=raw)
            elif m.distance is None and parse.norm_name(m.raw_rc_dist) is None:
                out[race_no] = dataclasses.replace(m, raw_rc_dist=raw)
        return [out[k] for k in sorted(out)]

    # ------------------------------------------------------------------ 위임
    def history(self, horse_nos: list[str], h: date) -> list[HistoryRow]:
        return self.sql.history(horse_nos, h)

    def jockey_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        return self.sql.jockey_stats(names, meet, h, window_days)

    def trainer_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        return self.sql.trainer_stats(names, meet, h, window_days)

    def rank_changes(self, horse_nos: list[str], d: date) -> list[RankChange]:
        return self.sql.rank_changes(horse_nos, d)

    def masters(self, horse_nos: list[str]) -> list[MasterRow]:
        return self.sql.masters(horse_nos)

    def results_through(self, h: date) -> date | None:
        return self.sql.results_through(h)

    def results_exist(self, d: date, meet: str) -> bool:
        return self.sql.results_exist(d, meet)

    def unresolved_races(self, h: date, days: int) -> list[tuple[date, str]]:
        return self.sql.unresolved_races(h, days)

    def results(self, d: date, meet: str) -> list[ResultRow]:
        return self.sql.results(d, meet)

    def win_dividends(self, d: date, meet: str) -> list[DividendRow]:
        return self.sql.win_dividends(d, meet)


# ---------------------------------------------------------------------------
# 경주·호 채점
# ---------------------------------------------------------------------------

Picks = tuple[tuple[int, str], ...]  # ((mark, horse_no), ...) mark 순


def settle_clock(d: date, defn: RuleSetDef) -> datetime:
    """과거 시험 정산 시각 — D+7 00:00 KST (무효 확정 이후, 결정적). 실행 시각과 무관하다."""
    return schedule.at_kst(schedule.void_after(d, defn), 0)


@dataclass(frozen=True)
class Substitution:
    """예비 기준(by)이 발행 기준(replaced)을 대신한 조합 — 주목마만 다시 계산."""

    replaced: str
    by: str
    rules: tuple[str, ...]

    @property
    def key(self) -> str:
        return f"{self.replaced}>{self.by}"


def substitutions(defn: RuleSetDef) -> tuple[Substitution, ...]:
    """발행 기준 하나를 예비 기준 하나로 바꾼 조합 전부 (발행 순서 → 예비 순서)."""
    return tuple(
        Substitution(
            replaced=k, by=x, rules=tuple(x if r == k else r for r in defn.rules)
        )
        for k in defn.rules
        for x in defn.backtest_extra_rules
    )


@dataclass(frozen=True)
class RaceScore:
    """한 경주의 채점 입력. outcome None = 정산 대기(보고서의 unsettled)."""

    race_date: date
    meet: str
    race_no: int
    small_field: bool
    outcome: Outcome | None
    picks: Mapping[str, Picks]  # 기준 키(발행·예비)·"consensus" → picked 인 것만
    combos: Mapping[str, Picks]  # Substitution.key → 그 조합의 주목마 picks


def _rule_result(obj: Mapping[str, Any]) -> rules.RuleResult:
    """payload RuleResultV1 dict → RuleResult (주목마 재계산용)."""
    if obj["status"] == rules.PICKED:
        return rules.RuleResult(
            key=obj["key"],
            status=rules.PICKED,
            picks=tuple(
                rules.Pick(
                    mark=int(p["mark"]),
                    horse_no=str(p["horse_no"]),
                    chul_no=int(p["chul_no"]),
                    reason=str(p["reason"]),
                )
                for p in obj["picks"]
            ),
        )
    return rules.RuleResult(
        key=obj["key"],
        status=rules.NO_PICK,
        reason_code=obj.get("reason_code"),
        reason=obj.get("reason"),
    )


def _picks_of(rr: rules.RuleResult) -> Picks:
    return tuple((p.mark, p.horse_no) for p in sorted(rr.picks, key=lambda p: p.mark))


def score_edition(
    provider: Any, d: date, meet: str, defn: RuleSetDef
) -> list[RaceScore]:
    """한 호(D, 경마장)를 backtest 모드로 만들고 정산까지 → 경주별 채점 입력."""
    meet_n = parse.normalize_meet(meet)
    if meet_n is None:
        raise ValueError(f"unknown meet: {meet!r}")
    res = build.build_edition(
        provider, d, meet_n, schedule.freeze_at(d, defn), defn, mode="backtest"
    )
    results = provider.results(d, meet_n)
    dividends = provider.win_dividends(d, meet_n)
    clock = settle_clock(d, defn)
    subs = substitutions(defn)
    out: list[RaceScore] = []
    for race in res.payload["races"]:
        race_no = int(race["race_no"])
        small = race["status"] == rules.SMALL_FIELD
        by_key: dict[str, rules.RuleResult] = {
            rr["key"]: _rule_result(rr)
            for rr in (*race["rules"], *res.extra_rule_results.get(race_no, []))
        }
        picks: dict[str, Picks] = {k: _picks_of(rr) for k, rr in by_key.items() if rr.is_picked}
        cons = tuple(
            (int(p["mark"]), str(p["horse_no"]))
            for p in sorted(race["consensus"]["picks"], key=lambda p: p["mark"])
        )
        if cons:
            picks[CONSENSUS_KEY] = cons
        combos: dict[str, Picks] = {}
        for sub in subs:
            combo_defn = dataclasses.replace(defn, rules=sub.rules)
            c = rules.consensus(
                [by_key[k] for k in sub.rules if k in by_key], combo_defn, small_field=small
            )
            combos[sub.key] = tuple((p.mark, p.horse_no) for p in c.picks)
        outcome = settle.settle_race(race, results, dividends, clock, d, defn)
        out.append(
            RaceScore(
                race_date=d,
                meet=meet_n,
                race_no=race_no,
                small_field=small,
                outcome=None if outcome.status == settle.PENDING else outcome,
                picks=picks,
                combos=combos,
            )
        )
    return out


# ---------------------------------------------------------------------------
# 집계
# ---------------------------------------------------------------------------


def _frac(x: Fraction) -> list[int]:
    return [x.numerator, x.denominator]


@dataclass
class Cell:
    """기준 × 기호 한 칸 — 웹 RuleRecordCell 과 같은 뜻 (기대값은 정확한 분수)."""

    n: int = 0
    wins: int = 0
    top3: int = 0
    voids: int = 0
    random_win: Fraction = field(default_factory=Fraction)
    random_top3: Fraction = field(default_factory=Fraction)
    fav_races: int = 0
    fav_win: Fraction = field(default_factory=Fraction)
    fav_top3: Fraction = field(default_factory=Fraction)
    pop_n: int = 0
    pop_sum: int = 0

    def add(self, horse_no: str, out: Outcome) -> str:
        """표시 하나 판정·누적 → settle.pick_outcome 판정."""
        verdict = settle.pick_outcome(horse_no, out)
        if verdict == "void":
            self.voids += 1
            return verdict
        self.n += 1
        if verdict == "win":
            self.wins += 1
        if verdict in ("win", "top3"):
            self.top3 += 1
        if out.starters > 0:
            self.random_win += Fraction(len(out.winners), out.starters)
            self.random_top3 += Fraction(len(out.placed), out.starters)
        if out.favorites:
            fav = set(out.favorites)
            self.fav_races += 1
            self.fav_win += Fraction(len(fav & set(out.winners)), len(fav))
            self.fav_top3 += Fraction(len(fav & set(out.placed)), len(fav))
        rank = out.pop_ranks.get(horse_no)
        if rank is not None:
            self.pop_n += 1
            self.pop_sum += int(rank)
        return verdict

    def to_json(self, rule_key: str, mark: int) -> dict[str, Any]:
        return {
            "rule_key": rule_key,
            "mark": mark,
            "n": self.n,
            "wins": self.wins,
            "top3": self.top3,
            "voids": self.voids,
            "random_win": _frac(self.random_win),
            "random_top3": _frac(self.random_top3),
            "fav_races": self.fav_races,
            "fav_win": _frac(self.fav_win),
            "fav_top3": _frac(self.fav_top3),
            "pop_n": self.pop_n,
            "pop_sum": self.pop_sum,
        }


@dataclass
class RuleAgg:
    """기준 단위 — 웹 RuleRecordRule 과 같은 뜻 + 참여율 분모."""

    races_picked: int = 0
    races_n: int = 0
    races_any_win: int = 0

    def add(self, verdicts: Sequence[str]) -> None:
        if not verdicts:
            return
        self.races_picked += 1
        if any(v != "void" for v in verdicts):
            self.races_n += 1
        if any(v == "win" for v in verdicts):
            self.races_any_win += 1

    def to_json(self, rule_key: str, races: int) -> dict[str, Any]:
        return {
            "rule_key": rule_key,
            "races_picked": self.races_picked,
            "races_n": self.races_n,
            "races_any_win": self.races_any_win,
            "participation": [self.races_picked, races],
        }


class Section:
    """보고서의 한 묶음(전체·경마장별)."""

    def __init__(self, defn: RuleSetDef) -> None:
        self.keys: tuple[str, ...] = (*defn.rules, *defn.backtest_extra_rules)
        self.subs = substitutions(defn)
        self.editions: set[tuple[date, str]] = set()
        self.races = 0
        self.races_void = 0
        self.small_field = 0
        self.unsettled = 0
        self.dates: list[date] = []
        self.cells: dict[tuple[str, int], Cell] = {}
        self.rules: dict[str, RuleAgg] = {}
        self.combo_cells: dict[str, Cell] = {s.key: Cell() for s in self.subs}
        self.combo_rules: dict[str, RuleAgg] = {s.key: RuleAgg() for s in self.subs}
        for k in self.keys:
            self.rules[k] = RuleAgg()
            for m in (1, 2, 3):
                self.cells[(k, m)] = Cell()
        self.cells[(CONSENSUS_KEY, 1)] = Cell()
        self.rules[CONSENSUS_KEY] = RuleAgg()

    def add_edition(self, d: date, meet: str) -> None:
        self.editions.add((d, meet))
        self.dates.append(d)

    def add_race(self, rs: RaceScore) -> None:
        if rs.small_field:
            self.small_field += 1
        out = rs.outcome
        if out is None:
            self.unsettled += 1
            return
        self.races += 1
        if out.status == settle.RACE_VOID:
            self.races_void += 1
        for key in (*self.keys, CONSENSUS_KEY):
            picks = rs.picks.get(key, ())
            if key == CONSENSUS_KEY:  # 주목마 지표는 1순위만 (계약 §6.1)
                picks = tuple(p for p in picks if p[0] == 1)
            verdicts = [self.cells[(key, m)].add(h, out) for m, h in picks]
            self.rules[key].add(verdicts)
        for sub in self.subs:
            picks = tuple(p for p in rs.combos.get(sub.key, ()) if p[0] == 1)
            verdicts = [self.combo_cells[sub.key].add(h, out) for _, h in picks]
            self.combo_rules[sub.key].add(verdicts)

    def to_json(self) -> dict[str, Any]:
        cells = [self.cells[(k, m)].to_json(k, m) for k in self.keys for m in (1, 2, 3)]
        cells.append(self.cells[(CONSENSUS_KEY, 1)].to_json(CONSENSUS_KEY, 1))
        rule_rows = [self.rules[k].to_json(k, self.races) for k in (*self.keys, CONSENSUS_KEY)]
        return {
            "editions": len(self.editions),
            "races": self.races,
            "races_void": self.races_void,
            "small_field": self.small_field,
            "unsettled": self.unsettled,
            "first_date": min(self.dates).isoformat() if self.dates else None,
            "last_date": max(self.dates).isoformat() if self.dates else None,
            "cells": cells,
            "rules": rule_rows,
            "substitutions": [
                {
                    "replaced": s.replaced,
                    "by": s.by,
                    "rules": list(s.rules),
                    "cell": self.combo_cells[s.key].to_json(CONSENSUS_KEY, 1),
                    "rule": self.combo_rules[s.key].to_json(CONSENSUS_KEY, self.races),
                }
                for s in self.subs
            ],
        }


class Agreement:
    """기준 사이 ◎ 일치 — 두 기준이 모두 ◎ 를 낸 경주 중 같은 말을 고른 경주 수."""

    def __init__(self, keys: Sequence[str]) -> None:
        self.keys = tuple(keys)
        self.pairs = [(a, b) for i, a in enumerate(self.keys) for b in self.keys[i + 1 :]]
        self.both = dict.fromkeys(self.pairs, 0)
        self.agree = dict.fromkeys(self.pairs, 0)

    def add_race(self, rs: RaceScore) -> None:
        top = {k: next((h for m, h in rs.picks.get(k, ()) if m == 1), None) for k in self.keys}
        for a, b in self.pairs:
            if top[a] is None or top[b] is None:
                continue
            self.both[(a, b)] += 1
            if top[a] == top[b]:
                self.agree[(a, b)] += 1

    def to_json(self) -> list[dict[str, Any]]:
        return [
            {"a": a, "b": b, "agree": self.agree[(a, b)], "both": self.both[(a, b)]}
            for a, b in self.pairs
        ]


@dataclass
class Tally:
    """과거 시험 전체 누적."""

    defn: RuleSetDef
    meets: tuple[str, ...]
    overall: Section = field(init=False)
    by_meet: dict[str, Section] = field(init=False)
    agreement: Agreement = field(init=False)
    editions_failed: int = 0
    errors: list[dict[str, Any]] = field(default_factory=list)
    durations_ms: list[int] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.overall = Section(self.defn)
        self.by_meet = {m: Section(self.defn) for m in self.meets}
        self.agreement = Agreement((*self.defn.rules, *self.defn.backtest_extra_rules))

    def add_edition(self, d: date, meet: str, races: Sequence[RaceScore]) -> None:
        for sec in (self.overall, self.by_meet[meet]):
            sec.add_edition(d, meet)
            for rs in races:
                sec.add_race(rs)
        for rs in races:
            self.agreement.add_race(rs)

    def add_error(self, d: date, meet: str, exc: BaseException) -> None:
        self.editions_failed += 1
        if len(self.errors) < MAX_ERRORS_IN_REPORT:
            self.errors.append(error_entry(d, meet, exc))


def error_entry(d: date, meet: str, exc: BaseException) -> dict[str, Any]:
    """보고서 errors[] 한 건 — 오류 문구는 마스킹 + 공백 정리 + 앞 300자."""
    msg = " ".join(redact(f"{type(exc).__name__}: {exc}").split())
    return {"race_date": d.isoformat(), "meet": meet, "error": msg[:_ERROR_TEXT_MAX]}


def _median(values: Sequence[int]) -> int:
    if not values:
        return 0
    s = sorted(values)
    return s[(len(s) - 1) // 2]  # 짝수 개면 아래쪽 중앙값 (정수)


def assert_no_float(obj: Any, path: str = "$") -> None:
    """보고서는 정수·문자열·bool·None·list·dict 만 (float 금지)."""
    if isinstance(obj, float):
        raise ValueError(f"보고서에 float 금지: {path} = {obj!r}")
    if isinstance(obj, Mapping):
        for k, v in obj.items():
            assert_no_float(v, f"{path}.{k}")
    elif isinstance(obj, list | tuple):
        for i, v in enumerate(obj):
            assert_no_float(v, f"{path}[{i}]")


def build_report(
    tally: Tally,
    *,
    label: str,
    d_from: date,
    d_to: date,
    total_ms: int,
) -> dict[str, Any]:
    """누적 → 보고서 v1 (계약 §10). 정수·[분자, 분모]·문자열만."""
    defn = tally.defn
    ov = tally.overall
    report: dict[str, Any] = {
        "report_version": REPORT_VERSION,
        "label": label,
        "candidate_version": defn.version,
        "definition_sha256": definitions.definition_sha256(defn),
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat()},
        "meets": list(tally.meets),
        "rules": list(defn.rules),
        "extra_rules": list(defn.backtest_extra_rules),
        "input": "results_starters",
        "counts": {
            "editions": len(ov.editions),
            "editions_failed": tally.editions_failed,
            "races": ov.races + ov.unsettled,
            "settled": ov.races,
            "races_void": ov.races_void,
            "small_field": ov.small_field,
            "unsettled": ov.unsettled,
        },
        "overall": ov.to_json(),
        "by_meet": {m: tally.by_meet[m].to_json() for m in tally.meets},
        "agreement": tally.agreement.to_json(),
        "runtime_ms": {
            "total": int(total_ms),
            "editions": len(tally.durations_ms),
            "edition_max": max(tally.durations_ms) if tally.durations_ms else 0,
            "edition_median": _median(tally.durations_ms),
        },
        "errors": list(tally.errors),
    }
    assert_no_float(report)
    return report


# ---------------------------------------------------------------------------
# 실행
# ---------------------------------------------------------------------------


def _as_factory(conn: Any) -> SessionFactory:
    """None → src.db.session_scope · Engine → engine.begin · 그 밖 = 트랜잭션 팩토리 그대로."""
    if conn is None:
        return queries.default_session_factory()
    if isinstance(conn, Engine):
        engine = conn

        @contextmanager
        def tx() -> Iterator[Any]:
            with engine.begin() as c:
                yield c

        return tx
    if callable(conn):
        return conn
    raise TypeError(f"run_backtest: conn 은 Engine 또는 트랜잭션 팩토리여야 한다 ({conn!r})")


def normalize_meets(meets: Iterable[str] | None) -> tuple[str, ...]:
    """경마장 목록 정규화 (VALID_MEETS 순서, 중복 제거). None·빈 목록 = 전체."""
    if not meets:
        return parse.VALID_MEETS
    got: set[str] = set()
    for m in meets:
        n = parse.normalize_meet(m)
        if n is None:
            raise BacktestError(f"알 수 없는 경마장: {m!r} (서울·부경·제주)")
        got.add(n)
    return tuple(m for m in parse.VALID_MEETS if m in got)


def month_chunks(d_from: date, d_to: date) -> list[tuple[date, date]]:
    """[d_from, d_to] 를 달력 월 단위 [lo, hi] 로 자른다."""
    out: list[tuple[date, date]] = []
    lo = d_from
    while lo <= d_to:
        nxt = date(lo.year + (lo.month == 12), lo.month % 12 + 1, 1)
        hi = min(d_to, nxt - timedelta(days=1))
        out.append((lo, hi))
        lo = nxt
    return out


def _targets(rows: Iterable[CalendarRow], meets: tuple[str, ...]) -> list[tuple[date, str]]:
    keys = {
        (r.race_date, m)
        for r in rows
        if (m := parse.normalize_meet(r.meet)) is not None and m in meets
    }
    order = {m: i for i, m in enumerate(parse.VALID_MEETS)}
    return sorted(keys, key=lambda k: (k[0], order[k[1]]))


class _Reopen(Exception):
    """DB 오류로 트랜잭션이 깨졌다 — 롤백하고 새 READ ONLY 트랜잭션으로 이어 간다."""


def compute_report(
    conn: Any,
    defn: RuleSetDef,
    d_from: date,
    d_to: date,
    meets: Iterable[str] | None,
    *,
    label: str,
    timer: Timer | None = None,
    statement_timeout_ms: int = STATEMENT_TIMEOUT_MS,
    lock_timeout_ms: int = LOCK_TIMEOUT_MS,
    fail_fast: bool = False,
) -> dict[str, Any]:
    """읽기만 — 월 단위 READ ONLY 트랜잭션으로 과거 시험을 돌려 보고서를 만든다 (저장 없음).

    fail_fast (holdout): 첫 실패 호에서 HoldoutIncomplete 로 멈춘다 — 오류가 든 보고서를
    만들지 않는다.
    아니면(dev) 실패한 호를 세고 다음 호로 간다 (DB 오류면 트랜잭션을 새로 연다).
    """
    factory = _as_factory(conn)
    meets_n = normalize_meets(meets)
    clock = timer or time.perf_counter
    tally = Tally(defn, meets_n)

    def ro() -> AbstractContextManager[SqlProvider]:
        return queries.read_only_provider(
            factory, statement_timeout_ms=statement_timeout_ms, lock_timeout_ms=lock_timeout_ms
        )

    started = clock()
    for lo, hi in month_chunks(d_from, d_to):
        with ro() as sql:
            targets = _targets(BacktestProvider(sql).calendar(lo, hi, meets_n), meets_n)
        i = 0
        while i < len(targets):
            try:
                with ro() as sql:
                    bp = BacktestProvider(sql)
                    while i < len(targets):
                        d, meet = targets[i]
                        i += 1
                        t0 = clock()
                        try:
                            races = score_edition(bp, d, meet, defn)
                        except Exception as e:
                            if fail_fast:  # holdout — 저장·출력 없이 멈춘다 (트랜잭션은 롤백)
                                raise HoldoutIncomplete([error_entry(d, meet, e)]) from e
                            tally.add_error(d, meet, e)
                            if isinstance(e, DBAPIError):  # 트랜잭션이 깨짐 → 새로 연다
                                raise _Reopen from e
                            continue  # 이 호만 실패, 다음 호는 계속
                        finally:
                            tally.durations_ms.append(int(round((clock() - t0) * 1000)))
                        tally.add_edition(d, meet, races)
            except _Reopen:
                continue
    total_ms = int(round((clock() - started) * 1000))
    return build_report(tally, label=label, d_from=d_from, d_to=d_to, total_ms=total_ms)


def holdout_row(conn: Any, sha: str) -> dict[str, Any] | None:
    """같은 정의 해시의 holdout 행 (없으면 None) — READ ONLY."""
    with queries.read_only_provider(_as_factory(conn)) as sql:
        r = sql.conn.execute(_HOLDOUT_ROW, {"sha": sha}).mappings().first()
    return dict(r) if r is not None else None


def save_report(
    conn: Any,
    report: Mapping[str, Any],
    *,
    defn: RuleSetDef,
    label: str,
    d_from: date,
    d_to: date,
    meets: Sequence[str],
    now: datetime,
    public: bool,
    code_rev: str | None,
) -> int:
    """racing_form_backtests 에 한 행 INSERT (report_sha256 은 SQL) → id. 추가 전용."""
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    assert_no_float(report)
    params = {
        "candidate_version": defn.version,
        "definition_sha256": definitions.definition_sha256(defn),
        "label": label,
        "period_from": d_from,
        "period_to": d_to,
        "meets": list(meets),
        "report": payload.canonical_json(report),
        "code_rev": code_rev,
        "is_public": bool(public),
        "computed_at": now,
    }
    try:
        with _as_factory(conn)() as c:
            row = c.execute(_INSERT_BACKTEST, params).first()
    except IntegrityError as e:
        constraint = getattr(getattr(e.orig, "diag", None), "constraint_name", None)
        if constraint == "uq_rf_backtests_holdout" or "uq_rf_backtests_holdout" in str(e.orig):
            raise HoldoutExists(
                f"{defn.version} (정의 {params['definition_sha256'][:12]}) 의 holdout 보고서가 "
                "그사이 저장됐다 — 이번 결과는 저장하지 않는다"
            ) from e
        raise
    assert row is not None
    return int(row[0])


def run_backtest(
    conn: Any,
    defn: RuleSetDef,
    d_from: date,
    d_to: date,
    meets: Iterable[str] | None,
    label: str,
    now: datetime,
    save: bool = False,
    public: bool = False,
    code_rev: str | None = None,
    *,
    timer: Timer | None = None,
) -> dict[str, Any]:
    """과거 시험 한 번 → 보고서 dict. holdout 은 저장이 끝난 뒤에만 돌려준다.

    conn: None(src.db.session_scope) · Engine · 트랜잭션 팩토리. meets: None = 서울·부경·제주.
    holdout 에서 한 호라도 실패하면 HoldoutIncomplete — 저장하지 않고 보고서도 돌려주지 않는다.
    """
    if label not in LABELS:
        raise BacktestError(f"label 은 dev 또는 holdout ({label!r})")
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    if d_from > d_to:
        raise BacktestError(f"기간이 거꾸로다 ({d_from} > {d_to})")
    today = schedule.kst_today(now)
    if d_to >= today:
        raise BacktestError(f"과거 시험 기간은 어제({today - timedelta(days=1)})까지여야 한다")
    if label == "dev" and save:
        raise BacktestError("dev 과거 시험은 저장하지 않는다 — 저장은 holdout 만")
    if label == "holdout" and not save:
        raise BacktestError(
            "holdout 은 저장해야 한다 (--save) — 결과는 기록한 뒤에만 볼 수 있다 (정의 해시당 1회)"
        )
    if public and not save:
        raise BacktestError("--public 은 저장할 때만 (holdout)")
    meets_n = normalize_meets(meets)
    sha = definitions.definition_sha256(defn)
    factory = _as_factory(conn)
    if label == "holdout":
        existing = holdout_row(factory, sha)
        if existing is not None:
            raise HoldoutExists(
                f"{defn.version} (정의 {sha[:12]}) 의 holdout 보고서가 이미 있다 "
                f"(id {existing['id']}) — 정의 해시당 1회라 계산하지 않는다"
            )
    holdout = label == "holdout"
    report = compute_report(
        factory, defn, d_from, d_to, meets_n, label=label, timer=timer, fail_fast=holdout
    )
    if holdout and report["counts"]["editions_failed"]:  # fail_fast 의 이중 안전장치
        raise HoldoutIncomplete(report["errors"])
    if save:
        save_report(
            factory,
            report,
            defn=defn,
            label=label,
            d_from=d_from,
            d_to=d_to,
            meets=meets_n,
            now=now,
            public=public,
            code_rev=code_rev,
        )
    return report


# ---------------------------------------------------------------------------
# 사람이 읽는 출력 (CLI)
# ---------------------------------------------------------------------------


def _pct_text(num: int, den: int) -> str:
    return f"{parse.pct(num, den)}%" if den > 0 else "-"


def _frac_rate_text(pair: Sequence[int], n: int) -> str:
    """기대 적중 수 p/q 를 n 경주의 비율로 → '9%'."""
    p, q = int(pair[0]), int(pair[1])
    if n <= 0 or q <= 0:
        return "-"
    return f"{(100 * p + (q * n) // 2) // (q * n)}%"


def _ratio(num: int, den: int) -> str:
    return f"{num:,}/{den:,} ({_pct_text(num, den)})"


def _label(key: str) -> str:
    return "주목마(1순위)" if key == CONSENSUS_KEY else RULE_LABELS.get(key, key)


def render_text(report: Mapping[str, Any]) -> str:
    """보고서 요약 (한국어). 퍼센트는 표시용으로만 계산한다 (저장값은 정수·분수)."""
    c = report["counts"]
    rt = report["runtime_ms"]
    lines = [
        f"경마지 과거 시험 — {report['label']} · {report['candidate_version']} "
        f"(정의 {report['definition_sha256'][:12]})",
        f"기간 {report['period']['from']} ~ {report['period']['to']} · "
        f"경마장 {'·'.join(report['meets'])} · 명단 = 결과표 출주(실제 기수·부담·결과표 레이팅)",
        f"호 {c['editions']:,} (실패 {c['editions_failed']}) · 경주 {c['races']:,} "
        f"(정산 {c['settled']:,} · 경주 무효 {c['races_void']} · 소두수 {c['small_field']} · "
        f"정산 안 됨 {c['unsettled']})",
        f"시간 합계 {rt['total'] / 1000:.1f}초 · 호당 최대 {rt['edition_max'] / 1000:.2f}초 · "
        f"중앙 {rt['edition_median'] / 1000:.2f}초",
    ]

    def section(title: str, sec: Mapping[str, Any]) -> None:
        lines.append("")
        lines.append(f"[{title}] 호 {sec['editions']} · 정산 경주 {sec['races']}")
        cells = {(x["rule_key"], x["mark"]): x for x in sec["cells"]}
        for r in sec["rules"]:
            k = r["rule_key"]
            honmei = cells[(k, 1)]
            part = r["participation"]
            cons = k == CONSENSUS_KEY
            mark = "" if cons else "◎ "
            parts = [
                f"  {_label(k)}: {'선정' if cons else '참여'} {_ratio(part[0], part[1])}",
                f"{mark}1착 {_ratio(honmei['wins'], honmei['n'])}"
                f" (무작위 {_frac_rate_text(honmei['random_win'], honmei['n'])}"
                f" · 1번 인기 {_frac_rate_text(honmei['fav_win'], honmei['fav_races'])})",
                f"{mark}3착 이내 {_ratio(honmei['top3'], honmei['n'])}",
            ]
            if not cons:
                o_n = cells[(k, 2)]["n"] + cells[(k, 3)]["n"]
                o_t = cells[(k, 2)]["top3"] + cells[(k, 3)]["top3"]
                voids = sum(cells[(k, m)]["voids"] for m in (1, 2, 3))
                parts.append(f"○△ 3착 이내 {_ratio(o_t, o_n)}")
                parts.append(f"1착마 포함 {_ratio(r['races_any_win'], r['races_n'])}")
                parts.append(f"무효 {voids}")
            else:
                parts.append(f"무효 {honmei['voids']}")
            lines.append(" · ".join(parts))
        for s in sec["substitutions"]:
            cell, rule = s["cell"], s["rule"]
            lines.append(
                f"  대체 {_label(s['replaced'])} → {_label(s['by'])}: 주목마 선정 "
                f"{_ratio(rule['races_picked'], rule['participation'][1])} · 1착 "
                f"{_ratio(cell['wins'], cell['n'])} · 3착 이내 {_ratio(cell['top3'], cell['n'])}"
            )

    section("전체", report["overall"])
    for m, sec in report["by_meet"].items():
        section(m, sec)
    lines.append("")
    lines.append("◎ 일치 (두 기준이 모두 ◎ 를 낸 경주 중 같은 말)")
    for a in report["agreement"]:
        lines.append(f"  {_label(a['a'])}·{_label(a['b'])} {_ratio(a['agree'], a['both'])}")
    if report["errors"]:
        lines.append("")
        lines.append(f"오류 {c['editions_failed']}건 (앞 {len(report['errors'])}건)")
        for e in report["errors"]:
            lines.append(f"  {e['race_date']} {e['meet']}: {e['error']}")
    lines.append("")
    lines.append("적중률은 수익을 뜻하지 않습니다. 회수율은 계산하지 않습니다.")
    return "\n".join(lines)
