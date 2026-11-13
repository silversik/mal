"""payload v1 조립·검증·직렬화 (계약 §4).

- `build_payload` — 기준·주목마·출전마·소식 결과를 PayloadV1 dict 로 (races 는 race_no 순,
  runners 는 chul_no 순, last5 는 오래된 → 최근). summary 는 payload 로부터 계산한다.
- `validate_v1` — float 금지, 키 집합, 순서, 기호 일관성, summary 일치를 검사
  (어긋나면 PayloadError).
- `canonical_json` — `json.dumps(sort_keys=True, ensure_ascii=False, separators=(",", ":"))`.
  DB 는 이 문자열을 `CAST(:payload AS jsonb)` 로 받고 해시는 SQL 에서만 계산한다.
- `picks_rows` — racing_form_picks INSERT 용 행 (기준 픽 votes=None + 주목마 votes=v).
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from .definitions import CONSENSUS_KEY, RULE_DEFINITIONS, RULE_KEYS, RULE_LABELS, RuleSetDef
from .features import Entrant, Start
from .news import Badge, Headline
from .rules import NO_PICK, PICKED, SMALL_FIELD, ConsensusResult, RuleResult
from .schedule import KST

SCHEMA_VERSION = 1

#: 계약 §4 — 1면 헤드라인 최대 수 (HeadlineV1[] 최대 6)
MAX_HEADLINES = 6

CONSENSUS_STATUSES = ("picked", "split", "insufficient", "small_field")


class PayloadError(ValueError):
    """payload v1 계약 위반."""


# ---------------------------------------------------------------------------
# 직렬화 보조
# ---------------------------------------------------------------------------


def iso_kst(dt: datetime) -> str:
    """tz-aware datetime → `2026-11-13T18:00:00+09:00` (초 단위, KST)."""
    if dt.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return dt.astimezone(KST).replace(microsecond=0).isoformat()


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------
# 조립
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RaceBuild:
    """build_payload 입력 — 경주 하나."""

    race_no: int
    race_name: str | None
    distance: int | None
    grade: str | None
    track_type: str | None
    start_time: str | None  # 'HH:MM' 정규화
    status: str  # ok | small_field
    stakes: Mapping[str, Any] | None
    entrants: tuple[Entrant, ...]  # 출전번호 순
    rule_results: tuple[RuleResult, ...]  # defn.rules 순서
    consensus: ConsensusResult
    badges: Mapping[str, tuple[Badge, ...]] = field(default_factory=dict)  # horse_no → 배지


def _start_json(s: Start) -> dict[str, Any]:
    return {
        "race_date": s.race_date.isoformat(),
        "meet": s.meet or s.meet_label or "",
        "race_no": s.race_no,
        "rank": s.rank,
        "distance": s.distance,
        "field_size": s.field_size,
    }


def _runner_json(
    e: Entrant, rules: Sequence[RuleResult], cons: ConsensusResult, badges: Sequence[Badge]
) -> dict[str, Any]:
    r, f = e.runner, e.feat
    marks: dict[str, int] = {}
    for rr in rules:
        m = rr.mark_of(r.horse_no) if rr.is_picked else None
        if m is not None:
            marks[rr.key] = m
    last = f.last
    return {
        "horse_no": r.horse_no,
        "chul_no": r.chul_no,
        "horse_name": r.horse_name or r.horse_no,
        "sex": r.sex,
        "age": r.age,
        "rating": r.rating,
        "rating_prev": f.rating_prev,
        "budam_tenths": r.budam_tenths,
        "jockey_name": r.jockey_name,
        "jockey_change": r.jockey_change.to_json() if r.jockey_change is not None else None,
        "trainer_name": r.trainer_name,
        "marks": marks,
        "consensus_mark": cons.mark_of(r.horse_no),
        "career": {"starts": f.career_starts, "wins": f.career_wins, "top3": f.career_top3},
        "last5": [_start_json(s) for s in f.last5],
        "days_since_last": f.days_since_last,
        "last_start": (
            {"race_date": last.race_date.isoformat(), "rank": last.rank} if last else None
        ),
        "course": (
            {
                "meet": f.course.meet,
                "distance": f.course.distance,
                "starts": f.course.starts,
                "wins": f.course.wins,
                "top3": f.course.top3,
            }
            if f.course is not None
            else None
        ),
        "best_time": (
            {
                "time_tenths": f.best_time.time_tenths,
                "race_date": f.best_time.race_date.isoformat(),
                "track_condition": f.best_time.track_condition,
            }
            if f.best_time is not None
            else None
        ),
        "badges": [b.to_json() for b in badges],
    }


def _race_json(rb: RaceBuild) -> dict[str, Any]:
    entrants = sorted(rb.entrants, key=lambda e: (e.runner.chul_no, e.runner.horse_no))
    return {
        "race_no": rb.race_no,
        "race_name": rb.race_name,
        "distance": rb.distance,
        "grade": rb.grade,
        "track_type": rb.track_type,
        "start_time": rb.start_time,
        "field_size": len(entrants),
        "status": rb.status,
        "stakes": (
            {"name": str(rb.stakes.get("name") or ""), "grade": rb.stakes.get("grade")}
            if rb.stakes is not None
            else None
        ),
        "rules": [rr.to_json() for rr in rb.rule_results],
        "consensus": rb.consensus.to_json(),
        "runners": [
            _runner_json(e, rb.rule_results, rb.consensus, rb.badges.get(e.runner.horse_no, ()))
            for e in entrants
        ],
    }


def build_payload(
    *,
    defn: RuleSetDef,
    race_date: date,
    meet: str,
    history_before: date,
    results_through: date | None,
    entries_batch_at: datetime | None,
    freeze_at: datetime,
    warnings: Sequence[str],
    races: Sequence[RaceBuild],
    headlines: Sequence[Headline],
    headline_overflow: int,
) -> dict[str, Any]:
    """PayloadV1 dict (summary 포함). 결정적 — 같은 입력이면 같은 canonical JSON."""
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "edition": {
            "race_date": race_date.isoformat(),
            "meet": meet,
            "rules_version": defn.version,
            "history_before": history_before.isoformat(),
            "results_through": results_through.isoformat() if results_through else None,
            "entries_batch_at": iso_kst(entries_batch_at) if entries_batch_at else None,
            "freeze_at": iso_kst(freeze_at),
            "warnings": list(warnings),
        },
        "rules": [
            {"key": k, "label": RULE_LABELS[k], "definition": RULE_DEFINITIONS[k]}
            for k in defn.rules
        ],
        "races": [_race_json(rb) for rb in sorted(races, key=lambda rb: rb.race_no)],
        "headlines": [h.to_json() for h in headlines],
        "headline_overflow": int(headline_overflow),
    }
    payload["summary"] = build_summary(payload)
    return payload


def _count_badges(payload: Mapping[str, Any], kind: str) -> int:
    return sum(
        1
        for race in payload["races"]
        for runner in race["runners"]
        for b in runner["badges"]
        if b["kind"] == kind
    )


def build_summary(payload: Mapping[str, Any]) -> dict[str, Any]:
    """SummaryV1 — payload 만으로 계산 (editions.summary = payload.summary)."""
    ed = payload["edition"]
    races_out: list[dict[str, Any]] = []
    for race in payload["races"]:
        cons = race["consensus"]
        names = {r["horse_no"]: r["horse_name"] for r in race["runners"]}
        top = next((p for p in cons["picks"] if p["mark"] == 1), None)
        races_out.append(
            {
                "race_no": race["race_no"],
                "race_name": race["race_name"],
                "start_time": race["start_time"],
                "distance": race["distance"],
                "field_size": race["field_size"],
                "stakes": race["stakes"] is not None,
                "consensus": {
                    "status": cons["status"],
                    "active_rules": cons["active_rules"],
                    "pick": (
                        {
                            "chul_no": top["chul_no"],
                            "horse_no": top["horse_no"],
                            "horse_name": names.get(top["horse_no"], top["horse_no"]),
                            "votes": top["votes"],
                        }
                        if top is not None
                        else None
                    ),
                },
            }
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "race_date": ed["race_date"],
        "meet": ed["meet"],
        "rules_version": ed["rules_version"],
        "race_count": len(payload["races"]),
        "runner_count": sum(int(r["field_size"]) for r in payload["races"]),
        "races": races_out,
        "counts": {
            "headlines": len(payload["headlines"]),
            "jockey_changes": _count_badges(payload, "jockey_change"),
            "debuts": _count_badges(payload, "debut"),
            "class_changes": _count_badges(payload, "class_change"),
        },
    }


# ---------------------------------------------------------------------------
# racing_form_picks 행
# ---------------------------------------------------------------------------


def picks_rows(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    """racing_form_picks INSERT 용 dict 목록 (edition_id 는 저장 시 붙인다).

    키: race_date(date) · meet · race_no · rule_key · rule_version · mark · horse_no · chul_no ·
    horse_name · votes(기준 픽 None, 주목마 v) · reason(주목마는 reasons 를 " · " 로 연결).
    순서: 경주 → 발행 기준 고정 순서 → mark, 경주마다 주목마가 뒤.
    """
    ed = payload["edition"]
    d = date.fromisoformat(ed["race_date"])
    rows: list[dict[str, Any]] = []
    for race in payload["races"]:
        names = {r["horse_no"]: r["horse_name"] for r in race["runners"]}
        base = {"race_date": d, "meet": ed["meet"], "race_no": race["race_no"]}
        for rr in race["rules"]:
            if rr["status"] != PICKED:
                continue
            for p in rr["picks"]:
                rows.append(
                    {
                        **base,
                        "rule_key": rr["key"],
                        "rule_version": ed["rules_version"],
                        "mark": p["mark"],
                        "horse_no": p["horse_no"],
                        "chul_no": p["chul_no"],
                        "horse_name": names.get(p["horse_no"]),
                        "votes": None,
                        "reason": p["reason"],
                    }
                )
        for p in race["consensus"]["picks"]:
            rows.append(
                {
                    **base,
                    "rule_key": CONSENSUS_KEY,
                    "rule_version": ed["rules_version"],
                    "mark": p["mark"],
                    "horse_no": p["horse_no"],
                    "chul_no": p["chul_no"],
                    "horse_name": names.get(p["horse_no"]),
                    "votes": p["votes"],
                    "reason": " · ".join(p["reasons"]),
                }
            )
    return rows


# ---------------------------------------------------------------------------
# 검증
# ---------------------------------------------------------------------------

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$")
_HHMM_RE = re.compile(r"^\d{2}:\d{2}$")


def _fail(path: str, msg: str) -> PayloadError:
    return PayloadError(f"{path}: {msg}")


def _walk_json(obj: Any, path: str) -> None:
    """JSON 기본형만 (float 금지)."""
    if obj is None or isinstance(obj, (bool, str)):
        return
    if isinstance(obj, int):
        return
    if isinstance(obj, float):
        raise _fail(path, f"float 금지 ({obj!r})")
    if isinstance(obj, list):
        for i, v in enumerate(obj):
            _walk_json(v, f"{path}[{i}]")
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str):
                raise _fail(path, f"키는 문자열이어야 함 ({k!r})")
            _walk_json(v, f"{path}.{k}")
        return
    raise _fail(path, f"JSON 이 아닌 값 ({type(obj).__name__})")


def _obj(value: Any, path: str, required: Sequence[str], optional: Sequence[str] = ()) -> dict:
    if not isinstance(value, dict):
        raise _fail(path, "객체가 아님")
    keys = set(value)
    missing = [k for k in required if k not in keys]
    if missing:
        raise _fail(path, f"키 누락 {missing}")
    extra = sorted(keys - set(required) - set(optional))
    if extra:
        raise _fail(path, f"모르는 키 {extra}")
    return value


def _typ(value: Any, spec: str, path: str) -> None:
    nullable = spec.endswith("?")
    base = spec.rstrip("?")
    if value is None:
        if nullable:
            return
        raise _fail(path, "null 불가")
    if base == "int":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif base == "str":
        ok = isinstance(value, str)
    elif base == "bool":
        ok = isinstance(value, bool)
    elif base == "date":
        ok = isinstance(value, str) and bool(_DATE_RE.match(value))
    elif base == "ts":
        ok = isinstance(value, str) and bool(_TS_RE.match(value))
    elif base == "hhmm":
        ok = isinstance(value, str) and bool(_HHMM_RE.match(value))
    elif base == "list":
        ok = isinstance(value, list)
    else:  # pragma: no cover - 방어
        raise ValueError(spec)
    if not ok:
        raise _fail(path, f"{spec} 아님 ({value!r})")


def _fields(obj: Mapping[str, Any], specs: Mapping[str, str], path: str) -> None:
    for k, spec in specs.items():
        _typ(obj.get(k), spec, f"{path}.{k}")


_EDITION = {
    "race_date": "date",
    "meet": "str",
    "rules_version": "str",
    "history_before": "date",
    "results_through": "date?",
    "entries_batch_at": "ts?",
    "freeze_at": "ts",
    "warnings": "list",
}
_RACE = {
    "race_no": "int",
    "race_name": "str?",
    "distance": "int?",
    "grade": "str?",
    "track_type": "str?",
    "start_time": "hhmm?",
    "field_size": "int",
    "status": "str",
    "rules": "list",
    "runners": "list",
}
_RUNNER = {
    "horse_no": "str",
    "chul_no": "int",
    "horse_name": "str",
    "sex": "str?",
    "age": "str?",
    "rating": "int?",
    "rating_prev": "int?",
    "budam_tenths": "int?",
    "jockey_name": "str?",
    "trainer_name": "str?",
    "consensus_mark": "int?",
    "last5": "list",
    "days_since_last": "int?",
    "badges": "list",
}
_LAST5 = {
    "race_date": "date",
    "meet": "str",
    "race_no": "int",
    "rank": "int?",
    "distance": "int?",
    "field_size": "int?",
}
_SUMMARY_RACE = {
    "race_no": "int",
    "race_name": "str?",
    "start_time": "hhmm?",
    "distance": "int?",
    "field_size": "int",
    "stakes": "bool",
}


def _validate_rule(rr: Any, path: str, runners: Mapping[str, int]) -> dict[str, int]:
    """기준 결과 하나 검사 → {horse_no: mark}."""
    if not isinstance(rr, dict):
        raise _fail(path, "객체가 아님")
    if rr.get("status") == PICKED:
        _obj(rr, path, ("key", "status", "picks"))
        picks = rr["picks"]
        _typ(picks, "list", f"{path}.picks")
        if not 1 <= len(picks) <= 3:
            raise _fail(path, f"picks 수 {len(picks)}")
        out: dict[str, int] = {}
        for i, p in enumerate(picks):
            pp = f"{path}.picks[{i}]"
            _obj(p, pp, ("mark", "horse_no", "chul_no", "reason"))
            _fields(p, {"mark": "int", "horse_no": "str", "chul_no": "int", "reason": "str"}, pp)
            if p["mark"] != i + 1:
                raise _fail(pp, "mark 는 1부터 차례대로")
            if runners.get(p["horse_no"]) != p["chul_no"]:
                raise _fail(pp, "출전마에 없는 말 또는 출전번호 불일치")
            if p["horse_no"] in out:
                raise _fail(pp, "같은 말 중복")
            out[p["horse_no"]] = p["mark"]
        return out
    if rr.get("status") == NO_PICK:
        _obj(rr, path, ("key", "status", "reason_code", "reason"))
        _fields(rr, {"reason_code": "str", "reason": "str"}, path)
        return {}
    raise _fail(path, f"status 이상 ({rr.get('status')!r})")


def _validate_race(race: Any, path: str, rule_keys: Sequence[str]) -> None:
    _obj(
        race,
        path,
        (
            "race_no",
            "race_name",
            "distance",
            "grade",
            "track_type",
            "start_time",
            "field_size",
            "status",
            "stakes",
            "rules",
            "consensus",
            "runners",
        ),
    )
    _fields(race, _RACE, path)
    if race["status"] not in ("ok", SMALL_FIELD):
        raise _fail(path, f"status 이상 ({race['status']!r})")
    if race["stakes"] is not None:
        _obj(race["stakes"], f"{path}.stakes", ("name", "grade"))
        _fields(race["stakes"], {"name": "str", "grade": "str?"}, f"{path}.stakes")

    # 출전마 — chul_no 순
    runners = race["runners"]
    if race["field_size"] != len(runners):
        raise _fail(path, "field_size ≠ runners 수")
    seen: dict[str, int] = {}
    prev: tuple[int, str] | None = None
    for i, runner in enumerate(runners):
        rp = f"{path}.runners[{i}]"
        _validate_runner(runner, rp)
        k = (runner["chul_no"], runner["horse_no"])
        if prev is not None and not prev < k:
            raise _fail(rp, "runners 는 chul_no 오름차순")
        prev = k
        if runner["horse_no"] in seen:
            raise _fail(rp, "같은 말 중복")
        seen[runner["horse_no"]] = runner["chul_no"]

    # 기준 — payload.rules 와 같은 순서
    rules = race["rules"]
    if [r.get("key") if isinstance(r, dict) else None for r in rules] != list(rule_keys):
        raise _fail(f"{path}.rules", "기준 순서가 payload.rules 와 다름")
    marks_by_rule: dict[str, dict[str, int]] = {}
    for j, rr in enumerate(rules):
        marks_by_rule[rr["key"]] = _validate_rule(rr, f"{path}.rules[{j}]", seen)
    picked_rules = [k for k in rule_keys if marks_by_rule[k]]
    if race["status"] == SMALL_FIELD and any(
        rr["status"] != NO_PICK or rr["reason_code"] != SMALL_FIELD for rr in rules
    ):
        raise _fail(path, "small_field 경주는 모든 기준이 small_field 예상 안 함")

    # 주목마
    cp = f"{path}.consensus"
    cons = _obj(race["consensus"], cp, ("status", "active_rules", "min_votes", "picks"))
    _fields(cons, {"status": "str", "active_rules": "int", "min_votes": "int", "picks": "list"}, cp)
    if cons["status"] not in CONSENSUS_STATUSES:
        raise _fail(cp, f"status 이상 ({cons['status']!r})")
    if (race["status"] == SMALL_FIELD) != (cons["status"] == "small_field"):
        raise _fail(cp, "small_field 불일치")
    if cons["active_rules"] != len(picked_rules):
        raise _fail(cp, "active_rules ≠ 예상을 낸 기준 수")
    if (cons["status"] == "picked") != bool(cons["picks"]) or len(cons["picks"]) > 2:
        raise _fail(cp, "picks 수와 status 불일치")
    cmarks: dict[str, int] = {}
    for i, p in enumerate(cons["picks"]):
        pp = f"{cp}.picks[{i}]"
        _obj(p, pp, ("mark", "horse_no", "chul_no", "votes", "marks", "reasons", "reasons_more"))
        _fields(
            p,
            {
                "mark": "int",
                "horse_no": "str",
                "chul_no": "int",
                "votes": "int",
                "reasons": "list",
                "reasons_more": "int",
            },
            pp,
        )
        if p["mark"] != i + 1 or seen.get(p["horse_no"]) != p["chul_no"]:
            raise _fail(pp, "mark 순서 또는 출전마 불일치")
        h = p["horse_no"]
        expect = {k: marks_by_rule[k][h] for k in rule_keys if h in marks_by_rule[k]}
        if p["marks"] != expect or p["votes"] != len(expect) or p["votes"] < cons["min_votes"]:
            raise _fail(pp, "marks·votes 가 기준 결과와 다름")
        if len(p["reasons"]) + p["reasons_more"] != p["votes"]:
            raise _fail(pp, "reasons + reasons_more ≠ votes")
        if not all(isinstance(x, str) for x in p["reasons"]):
            raise _fail(pp, "reasons 는 문자열")
        cmarks[p["horse_no"]] = p["mark"]

    # 출전마 기호 = 기준 결과
    for i, runner in enumerate(runners):
        h = runner["horse_no"]
        expect = {k: marks_by_rule[k][h] for k in rule_keys if h in marks_by_rule[k]}
        if runner["marks"] != expect:
            raise _fail(f"{path}.runners[{i}].marks", "기준 결과와 다름")
        if runner["consensus_mark"] != cmarks.get(h):
            raise _fail(f"{path}.runners[{i}].consensus_mark", "주목마와 다름")


def _validate_runner(runner: Any, path: str) -> None:
    _obj(
        runner,
        path,
        (
            "horse_no",
            "chul_no",
            "horse_name",
            "sex",
            "age",
            "rating",
            "rating_prev",
            "budam_tenths",
            "jockey_name",
            "jockey_change",
            "trainer_name",
            "marks",
            "consensus_mark",
            "career",
            "last5",
            "days_since_last",
            "last_start",
            "course",
            "best_time",
            "badges",
        ),
    )
    _fields(runner, _RUNNER, path)
    if not isinstance(runner["marks"], dict):
        raise _fail(f"{path}.marks", "객체가 아님")
    for k, m in runner["marks"].items():
        if k not in RULE_KEYS or m not in (1, 2, 3):
            raise _fail(f"{path}.marks", f"이상한 기호 {k}={m!r}")
    jc = runner["jockey_change"]
    if jc is not None:
        jp = f"{path}.jockey_change"
        _obj(jc, jp, ("before", "after", "reason", "weight_before_tenths", "weight_after_tenths"))
        _fields(
            jc,
            {
                "before": "str?",
                "after": "str?",
                "reason": "str?",
                "weight_before_tenths": "int?",
                "weight_after_tenths": "int?",
            },
            jp,
        )
    _obj(runner["career"], f"{path}.career", ("starts", "wins", "top3"))
    _fields(runner["career"], {"starts": "int", "wins": "int", "top3": "int"}, f"{path}.career")
    last5 = runner["last5"]
    if len(last5) > 5:
        raise _fail(f"{path}.last5", "최대 5")
    prev: tuple[str, int] | None = None
    for i, s in enumerate(last5):
        sp = f"{path}.last5[{i}]"
        _obj(s, sp, tuple(_LAST5))
        _fields(s, _LAST5, sp)
        k = (s["race_date"], s["race_no"])
        if prev is not None and k < prev:
            raise _fail(sp, "last5 는 오래된 → 최근")
        prev = k
    if runner["last_start"] is not None:
        lp = f"{path}.last_start"
        _obj(runner["last_start"], lp, ("race_date", "rank"))
        _fields(runner["last_start"], {"race_date": "date", "rank": "int?"}, lp)
    if runner["course"] is not None:
        cp = f"{path}.course"
        _obj(runner["course"], cp, ("meet", "distance", "starts", "wins", "top3"))
        _fields(
            runner["course"],
            {"meet": "str", "distance": "int", "starts": "int", "wins": "int", "top3": "int"},
            cp,
        )
    if runner["best_time"] is not None:
        bp = f"{path}.best_time"
        _obj(runner["best_time"], bp, ("time_tenths", "race_date", "track_condition"))
        _fields(
            runner["best_time"],
            {"time_tenths": "int", "race_date": "date", "track_condition": "str?"},
            bp,
        )
    for i, b in enumerate(runner["badges"]):
        bp = f"{path}.badges[{i}]"
        _obj(b, bp, ("kind", "text"), ("delta",))
        _fields(b, {"kind": "str", "text": "str"}, bp)
        if "delta" in b:
            _typ(b["delta"], "int", f"{bp}.delta")


def validate_v1(payload: Any) -> None:
    """payload v1 계약 검사. 어긋나면 PayloadError (ValueError)."""
    _walk_json(payload, "$")
    _obj(
        payload,
        "$",
        (
            "schema_version",
            "edition",
            "rules",
            "races",
            "headlines",
            "headline_overflow",
            "summary",
        ),
    )
    if payload["schema_version"] != SCHEMA_VERSION:
        raise _fail("$.schema_version", "1 이어야 함")
    ed = _obj(payload["edition"], "$.edition", tuple(_EDITION))
    _fields(ed, _EDITION, "$.edition")
    if not all(isinstance(w, str) for w in ed["warnings"]):
        raise _fail("$.edition.warnings", "문자열 목록이어야 함")

    rules = payload["rules"]
    _typ(rules, "list", "$.rules")
    keys: list[str] = []
    for i, r in enumerate(rules):
        rp = f"$.rules[{i}]"
        _obj(r, rp, ("key", "label", "definition"))
        _fields(r, {"key": "str", "label": "str", "definition": "str"}, rp)
        if r["key"] not in RULE_KEYS or r["key"] in keys:
            raise _fail(rp, f"기준 키 이상 ({r['key']!r})")
        keys.append(r["key"])

    races = payload["races"]
    _typ(races, "list", "$.races")
    prev_no: int | None = None
    for i, race in enumerate(races):
        _validate_race(race, f"$.races[{i}]", keys)
        if prev_no is not None and race["race_no"] <= prev_no:
            raise _fail(f"$.races[{i}]", "races 는 race_no 오름차순")
        prev_no = race["race_no"]

    heads = payload["headlines"]
    _typ(heads, "list", "$.headlines")
    if len(heads) > MAX_HEADLINES:
        raise _fail("$.headlines", f"최대 {MAX_HEADLINES}")
    for i, hl in enumerate(heads):
        hp = f"$.headlines[{i}]"
        _obj(hl, hp, ("kind", "race_no", "chul_no", "horse_no", "text"))
        _fields(
            hl,
            {
                "kind": "str",
                "race_no": "int?",
                "chul_no": "int?",
                "horse_no": "str?",
                "text": "str",
            },
            hp,
        )
    _typ(payload["headline_overflow"], "int", "$.headline_overflow")
    if payload["headline_overflow"] < 0:
        raise _fail("$.headline_overflow", "음수 불가")

    summary = payload["summary"]
    _obj(
        summary,
        "$.summary",
        (
            "schema_version",
            "race_date",
            "meet",
            "rules_version",
            "race_count",
            "runner_count",
            "races",
            "counts",
        ),
    )
    for i, sr in enumerate(summary["races"] if isinstance(summary["races"], list) else []):
        sp = f"$.summary.races[{i}]"
        _obj(sr, sp, (*_SUMMARY_RACE, "consensus"))
        _fields(sr, _SUMMARY_RACE, sp)
    if summary != build_summary(payload):
        raise _fail("$.summary", "payload 로 다시 계산한 summary 와 다름")
