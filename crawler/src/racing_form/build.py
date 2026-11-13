"""한 호(경주일 D, 경마장) 만들기 — provider 입력 → payload v1 + picks 행. 쓰기 없음.

mode
- live: 발행 잡. D 결과가 있으면 발행 불가(NotPublishable "results_present"),
  enforce_window 이면 발행 창 밖도 불가("not_in_window"). 데이터 가드(fail-closed, GuardError):
  no_entries(출전마 0) · history_coverage_low(마스터상 경력마 ≥ 10 인데 이력 커버리지 < 50%) ·
  all_nopick_majority(절반 넘는 경주에서 모든 기준이 예상 안 함). 경고: entries_stale,
  unresolved_history:<date>|<meet>.
- replay: 지난 호 다시 만들기(dry-run 대조). 가드·창·D 결과 검사를 하지 않는다.
- backtest: 과거 시험. replay 에 더해 소식을 끈다(배지·헤드라인 비움, Q4·Q5 조회 안 함) +
  예비 기준(defn.backtest_extra_rules)을 함께 계산해 `extra_rule_results` 로 돌려준다(payload 밖).

H = schedule.history_before(d) — 이력은 race_date < H (provider + assert_strictly_before 이중 차단).
현재 시각은 읽지 않는다 — now 는 인자.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal

from . import features, news, parse, payload, rules, schedule
from .definitions import RuleSetDef
from .features import Entrant
from .news import Badge, RaceNews
from .types import ConnStat, HistoryRow, MasterRow, Provider, RankChange

Mode = Literal["live", "replay", "backtest"]
MODES: tuple[str, ...] = ("live", "replay", "backtest")

#: live 경고 — 이력 창 안 미해결 경주를 보는 기간(일)
UNRESOLVED_LOOKBACK_DAYS = 14


class RacingFormError(Exception):
    """경마지 발행 오류 기반."""


class GuardError(RacingFormError):
    """live 데이터 가드 실패 (fail-closed). code: no_entries · history_coverage_low ·
    all_nopick_majority."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class NotPublishable(RacingFormError):
    """live 발행 조건 아님. code: not_in_window · results_present."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class BuildResult:
    """build_edition 결과.

    payload: PayloadV1 dict (validate_v1 통과). picks: payload.picks_rows(payload).
    warnings: payload.edition.warnings + 빌드 전용 경고(live·enforce_window=False 에서 창 밖이면
    "not_in_window"). meta: 저장용 값(date/datetime 객체) — results_through · entries_batch_at ·
    freeze_at · deadline_at · first_post · race_count · runner_count · history_before ·
    rules_version · schema_version · mode.
    extra_rule_results: backtest 에서만 — {race_no: [RuleResultV1 dict, ...]}
    (defn.backtest_extra_rules 순서).
    """

    payload: dict[str, Any]
    picks: list[dict[str, Any]]
    warnings: list[str]
    meta: dict[str, Any]
    extra_rule_results: dict[int, list[dict[str, Any]]] = field(default_factory=dict)


def _stats_map(rows: list[ConnStat]) -> dict[str, ConnStat]:
    out: dict[str, ConnStat] = {}
    for st in rows:
        name = parse.norm_name(st.name)
        if name is not None:
            out[name] = st
    return out


def build_edition(
    provider: Provider,
    d: date,
    meet: str,
    now: datetime,
    defn: RuleSetDef,
    mode: Mode = "live",
    enforce_window: bool = False,
) -> BuildResult:
    if mode not in MODES:
        raise ValueError(f"unknown mode: {mode!r}")
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    meet_n = parse.normalize_meet(meet)
    if meet_n is None:
        raise ValueError(f"unknown meet: {meet!r}")
    live = mode == "live"
    backtest = mode == "backtest"

    h = schedule.history_before(d, defn)
    cal = [
        c
        for c in provider.calendar(d, d, (meet_n,))
        if c.race_date == d and parse.normalize_meet(c.meet) == meet_n
    ]
    first_post = cal[0].first_post if cal else None
    freeze = schedule.freeze_at(d, defn)
    deadline = schedule.deadline_at(d, first_post, defn)

    build_warnings: list[str] = []
    if live:
        if not schedule.in_window(now, d, first_post, defn):
            if enforce_window:
                raise NotPublishable(
                    "not_in_window",
                    f"발행 창 [{payload.iso_kst(freeze)}, {payload.iso_kst(deadline)}) 밖",
                )
            build_warnings.append("not_in_window")
        if provider.results_exist(d, meet_n):
            raise NotPublishable("results_present", f"{d.isoformat()} {meet_n} 결과가 이미 있음")

    # 출전명단
    entry_rows = provider.entries(d, meet_n)
    batch_at = features.entries_batch_at(entry_rows)
    by_race, warnings = features.select_active_entries(entry_rows, defn)
    runners = [r for rs in by_race.values() for r in rs]
    if live and not runners:
        raise GuardError("no_entries", f"{d.isoformat()} {meet_n} 활성 출전마 없음")

    metas = {m.race_no: m for m in provider.race_meta(d, meet_n)}
    distances = {
        race_no: (
            features.race_distance(metas[race_no].distance, metas[race_no].raw_rc_dist, defn)
            if race_no in metas
            else None
        )
        for race_no in by_race
    }

    # 이력 (< H)
    horse_nos = sorted({r.horse_no for r in runners})
    hist: list[HistoryRow] = list(provider.history(horse_nos, h)) if horse_nos else []
    features.assert_strictly_before(hist, h)
    hist_by_horse: dict[str, list[HistoryRow]] = defaultdict(list)
    for row in hist:
        hist_by_horse[str(row.horse_no).strip()].append(row)

    entrants_by_race: dict[int, tuple[Entrant, ...]] = {}
    for race_no, rs in by_race.items():
        entrants_by_race[race_no] = tuple(
            Entrant(
                r,
                features.compute_features(
                    r.horse_no,
                    hist_by_horse.get(r.horse_no, []),
                    d=d,
                    h=h,
                    meet=meet_n,
                    distance=distances[race_no],
                    defn=defn,
                ),
            )
            for r in rs
        )

    # 기수·조교사 집계 (같은 meet, [H − window, H))
    keys_needed = tuple(defn.rules) + (tuple(defn.backtest_extra_rules) if backtest else ())
    jockey_stats: dict[str, ConnStat] = {}
    trainer_stats: dict[str, ConnStat] = {}
    if "jockey" in keys_needed:
        names = sorted({r.jockey_name for r in runners if r.jockey_name})
        if names:
            jockey_stats = _stats_map(
                provider.jockey_stats(
                    names, meet_n, h, int(defn.p("rules", "jockey", "window_days"))
                )
            )
    if "trainer" in keys_needed:
        names = sorted({r.trainer_name for r in runners if r.trainer_name})
        if names:
            trainer_stats = _stats_map(
                provider.trainer_stats(
                    names, meet_n, h, int(defn.p("rules", "trainer", "window_days"))
                )
            )

    # 소식 입력 (backtest 는 조회하지 않음 — Q4·Q5 는 현재 테이블이라 as-of 불가)
    rank_by_horse: dict[str, RankChange] = {}
    master_by_horse: dict[str, MasterRow] = {}
    if not backtest and horse_nos:
        rc_rows = provider.rank_changes(horse_nos, d)
        for hn in horse_nos:
            rc = news.latest_rank_change(rc_rows, hn, d)
            if rc is not None:
                rank_by_horse[hn] = rc
        for m in provider.masters(horse_nos):
            master_by_horse[str(m.horse_no).strip()] = m

    # 경주별 기준·주목마·배지
    race_builds: list[payload.RaceBuild] = []
    race_news: list[RaceNews] = []
    extra: dict[int, list[dict[str, Any]]] = {}
    for race_no in sorted(by_race):
        entrants = entrants_by_race[race_no]
        meta = metas.get(race_no)
        inputs = rules.RaceInputs(
            race_no=race_no,
            meet=meet_n,
            distance=distances[race_no],
            entrants=entrants,
            jockey_stats=jockey_stats,
            trainer_stats=trainer_stats,
        )
        small = rules.is_small_field(inputs, defn)
        published = rules.evaluate_all(defn.rules, inputs, defn)
        cons = rules.consensus(published, defn, small_field=small)
        if backtest:
            extra[race_no] = [
                rr.to_json() for rr in rules.evaluate_all(defn.backtest_extra_rules, inputs, defn)
            ]
        stakes = news.stakes_info(meta)
        badges: dict[str, tuple[Badge, ...]] = {}
        if not backtest:
            for e in entrants:
                badges[e.runner.horse_no] = tuple(
                    news.runner_badges(
                        e,
                        d=d,
                        meet=meet_n,
                        distance=distances[race_no],
                        rank_change=rank_by_horse.get(e.runner.horse_no),
                        master=master_by_horse.get(e.runner.horse_no),
                        defn=defn,
                    )
                )
        race_builds.append(
            payload.RaceBuild(
                race_no=race_no,
                race_name=parse.norm_name(meta.race_name) if meta else None,
                distance=distances[race_no],
                grade=parse.norm_name(meta.grade) if meta else None,
                track_type=parse.norm_name(meta.track_type) if meta else None,
                start_time=parse.fmt_hhmm(meta.start_time) if meta else None,
                status=rules.SMALL_FIELD if small else "ok",
                stakes=stakes,
                entrants=entrants,
                rule_results=published,
                consensus=cons,
                badges=badges,
            )
        )
        race_news.append(
            RaceNews(
                race_no=race_no,
                stakes=stakes,
                distance=distances[race_no],
                runners=tuple((e, badges.get(e.runner.horse_no, ())) for e in entrants),
            )
        )

    if backtest:
        headlines: list[news.Headline] = []
        overflow = 0
    else:
        headlines, overflow = news.build_headlines(race_news, defn)

    # live 데이터 가드 (fail-closed)
    if live:
        _guard_history_coverage(entrants_by_race, master_by_horse, defn)
        _guard_all_nopick(race_builds, defn)
        stale_h = int(defn.p("guards", "entries_stale_warn_hours"))
        if batch_at is not None and now - batch_at > timedelta(hours=stale_h):
            warnings.append("entries_stale")
        warnings.extend(
            f"unresolved_history:{ud.isoformat()}|{um}"
            for ud, um in sorted(set(provider.unresolved_races(h, UNRESOLVED_LOOKBACK_DAYS)))
        )

    results_through = provider.results_through(h)
    pl = payload.build_payload(
        defn=defn,
        race_date=d,
        meet=meet_n,
        history_before=h,
        results_through=results_through,
        entries_batch_at=batch_at,
        freeze_at=freeze,
        warnings=warnings,
        races=race_builds,
        headlines=headlines,
        headline_overflow=overflow,
    )
    payload.validate_v1(pl)

    runner_count = sum(len(rb.entrants) for rb in race_builds)
    meta_out: dict[str, Any] = {
        "results_through": results_through,
        "entries_batch_at": batch_at,
        "freeze_at": freeze,
        "deadline_at": deadline,
        "first_post": first_post,
        "race_count": len(race_builds),
        "runner_count": runner_count,
        "history_before": h,
        "rules_version": defn.version,
        "schema_version": payload.SCHEMA_VERSION,
        "mode": mode,
    }
    return BuildResult(
        payload=pl,
        picks=payload.picks_rows(pl),
        warnings=[*pl["edition"]["warnings"], *build_warnings],
        meta=meta_out,
        extra_rule_results=extra,
    )


def _guard_history_coverage(
    entrants_by_race: dict[int, tuple[Entrant, ...]],
    masters: dict[str, MasterRow],
    defn: RuleSetDef,
) -> None:
    """마스터상 경력마(total_race_count > 0)가 min_veterans 이상인데, 그중 이력 행이 있는 말이
    min_history_coverage_pct 미만이면 GuardError (race_results 수집 누락 의심)."""
    min_vets = int(defn.p("guards", "min_veterans_for_coverage"))
    min_pct = int(defn.p("guards", "min_history_coverage_pct"))
    vets = covered = 0
    for entrants in entrants_by_race.values():
        for e in entrants:
            m = masters.get(e.runner.horse_no)
            if m is None or not m.total_race_count or m.total_race_count <= 0:
                continue
            vets += 1
            if e.feat.history_rows > 0:
                covered += 1
    if vets >= min_vets and covered * 100 < min_pct * vets:
        raise GuardError(
            "history_coverage_low",
            f"경력마 {vets}두 중 이력이 있는 말 {covered}두 (기준 {min_pct}%)",
        )


def _guard_all_nopick(race_builds: list[payload.RaceBuild], defn: RuleSetDef) -> None:
    """모든 발행 기준이 예상 안 함인 경주가 max_all_nopick_races_pct 를 넘으면 GuardError."""
    total = len(race_builds)
    if total == 0:
        return
    max_pct = int(defn.p("guards", "max_all_nopick_races_pct"))
    nopick = sum(1 for rb in race_builds if not any(rr.is_picked for rr in rb.rule_results))
    if nopick * 100 > max_pct * total:
        raise GuardError(
            "all_nopick_majority",
            f"{total}경주 중 {nopick}경주에서 모든 기준이 예상 안 함 (기준 {max_pct}%)",
        )
