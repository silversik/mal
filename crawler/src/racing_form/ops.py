"""경마지 운영 CLI 보조 — `src.main` 의 racing-form-* 명령이 쓴다 (발행 명령은 없다).

- `parse_meet` · `parse_day`: CLI 입력 (서울·부경·제주 또는 seoul·busan·jeju, YYYY-MM-DD·YYYYMMDD).
- `dry_run_build`: READ ONLY 트랜잭션에서 build_edition — live 의 발행 창·D 결과 검사는 경고로만
  남기고 계속 계산한다(쓰지 않음). 데이터 가드(GuardError)는 오류로 돌려준다.
- `show_edition`: 저장된 발행본·정산·공지 요약 (READ ONLY).
- `settle_once`: 정산 잡과 같은 규칙으로 1회 (`--date` 면 그 경주일 발행본만).
- `add_operator_notice`: 운영자 공지 erratum · withdrawn · paused (source='operator',
  dedup_key 는 계약 §7, 추가 전용 — 지울 수 없다).

현재 시각을 읽지 않는다 — now 는 CLI 가 KST 로 넘긴다.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from sqlalchemy import text

from . import build, definitions, parse, queries, schedule, settle, store
from .build import BuildResult
from .definitions import RULE_LABELS, RuleSetDef
from .schedule import KST

SessionFactory = Callable[[], AbstractContextManager[Any]]

#: URL slug ↔ DB 라벨 (웹 FORM_MEETS 와 같다)
MEET_SLUGS: dict[str, str] = {"seoul": "서울", "busan": "부경", "jeju": "제주"}

OPERATOR_KINDS: tuple[str, ...] = ("erratum", "withdrawn", "paused")
BUILD_MODES: tuple[str, ...] = ("live", "replay")

_WEEKDAY_KO = "월화수목금토일"
_MARK = {1: "◎", 2: "○", 3: "△"}
_VERDICT = {
    "win": "1착",
    "top3": "3착 이내",
    "miss": "빗나감",
    "void": "무효",
    "pending": "대기",
}


# ---------------------------------------------------------------------------
# 입력
# ---------------------------------------------------------------------------


def parse_meet(value: str) -> str:
    """'서울'·'부경'·'제주'·'부산경남' 또는 slug 'seoul'·'busan'·'jeju' → DB 라벨."""
    v = str(value).strip()
    meet = MEET_SLUGS.get(v.lower()) or parse.normalize_meet(v)
    if meet is None:
        raise ValueError(f"경마장은 서울·부경·제주 (또는 seoul·busan·jeju): {value!r}")
    return meet


def parse_day(value: str) -> date:
    """'2026-11-14' 또는 '20261114' → date."""
    v = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"날짜 형식은 YYYY-MM-DD 또는 YYYYMMDD: {value!r}")


def ymd_ko(d: date) -> str:
    return f"{d.isoformat()}({_WEEKDAY_KO[d.weekday()]})"


def _kst_text(dt: datetime | None) -> str:
    return "-" if dt is None else dt.astimezone(KST).strftime("%Y-%m-%d %H:%M KST")


def json_default(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.astimezone(KST).isoformat() if obj.tzinfo else obj.isoformat()
    if isinstance(obj, date):
        return obj.isoformat()
    raise TypeError(f"JSON 으로 바꿀 수 없는 값: {type(obj).__name__}")


# ---------------------------------------------------------------------------
# racing-form-build (dry-run)
# ---------------------------------------------------------------------------


class _DryRunProvider:
    """live 의 D 결과 검사를 경고로 바꾸는 얇은 래퍼 — results_exist 는 False, 실제 값은 기록."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.results_present = False

    def results_exist(self, d: date, meet: str) -> bool:
        self.results_present = bool(self._inner.results_exist(d, meet))
        return False

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


@dataclass(frozen=True)
class DryRun:
    d: date
    meet: str
    mode: str
    result: BuildResult | None
    warnings: list[str] = field(default_factory=list)
    error_code: str | None = None
    error: str | None = None


def dry_run_build(
    d: date,
    meet: str,
    now: datetime,
    *,
    mode: str = "live",
    defn: RuleSetDef | None = None,
    session_factory: SessionFactory | None = None,
) -> DryRun:
    """한 호를 계산만 (저장 없음, READ ONLY). live 는 창·D 결과를 경고로 (`not_in_window` ·
    `results_present`), 데이터 가드 실패는 error_code 로."""
    if mode not in BUILD_MODES:
        raise ValueError(f"mode 는 live 또는 replay ({mode!r})")
    rule_set = defn if defn is not None else definitions.active()
    with queries.read_only_provider(session_factory) as sql:
        provider: Any = _DryRunProvider(sql) if mode == "live" else sql
        try:
            res = build.build_edition(
                provider, d, meet, now, rule_set, mode=mode, enforce_window=False  # type: ignore[arg-type]
            )
        except build.GuardError as e:
            warnings = ["results_present"] if getattr(provider, "results_present", False) else []
            return DryRun(d, meet, mode, None, warnings, e.code, e.message)
    warnings = list(res.warnings)
    if getattr(provider, "results_present", False):
        warnings.append("results_present")
    return DryRun(d, meet, mode, res, warnings)


def render_build_json(run: DryRun) -> str:
    body: dict[str, Any] = {
        "race_date": run.d,
        "meet": run.meet,
        "mode": run.mode,
        "saved": False,
        "warnings": run.warnings,
        "error_code": run.error_code,
        "error": run.error,
        "meta": run.result.meta if run.result else None,
        "payload": run.result.payload if run.result else None,
    }
    return json.dumps(body, ensure_ascii=False, indent=2, default=json_default)


def _horse_label(race: Mapping[str, Any], horse_no: str) -> str:
    runner = next((r for r in race["runners"] if r["horse_no"] == horse_no), None)
    if runner is None:
        return horse_no
    return f"[{runner['chul_no']}] {runner['horse_name']}"


def _rule_line(race: Mapping[str, Any], rr: Mapping[str, Any]) -> str:
    label = RULE_LABELS.get(rr["key"], rr["key"])
    if rr["status"] != "picked":
        return f"    {label}: 예상 안 함 — {rr['reason']}"
    picks = " ".join(
        f"{_MARK[p['mark']]}{_horse_label(race, p['horse_no'])}" for p in rr["picks"]
    )
    return f"    {label}: {picks}"


def _consensus_text(race: Mapping[str, Any]) -> str:
    cons = race["consensus"]
    st = cons["status"]
    if st == "picked":
        top = cons["picks"][0]
        return (
            f"주목마 {_horse_label(race, top['horse_no'])} (예상을 낸 기준 "
            f"{cons['active_rules']}개 중 {top['votes']}개)"
        )
    if st == "split":
        return "혼전 — 기준마다 고른 말이 다름"
    if st == "insufficient":
        return f"주목마 없음 — 예상을 낸 기준 {cons['active_rules']}개"
    return f"예상 안 함 — 출전 {race['field_size']}두"


def render_build_text(run: DryRun) -> str:
    head = f"경마지 dry-run · {ymd_ko(run.d)} {run.meet} · {run.mode} · 저장하지 않음"
    if run.result is None:
        lines = [head, f"데이터 가드 실패 ({run.error_code}): {run.error}"]
        if run.warnings:
            lines.append("경고: " + ", ".join(run.warnings))
        lines.append("→ live 발행이었다면 이 호는 발행되지 않는다 (fail-closed)")
        return "\n".join(lines)
    meta = run.result.meta
    pl = run.result.payload
    lines = [
        f"{head} · 기준 {meta['rules_version']}",
        f"동결 {_kst_text(meta['freeze_at'])} · 마감 {_kst_text(meta['deadline_at'])} · "
        f"첫 발주 {meta['first_post'] or '미정'} · H {meta['history_before']} "
        f"(성적 반영 {meta['results_through'] or '-'}까지) · 출전표 배치 "
        f"{_kst_text(meta['entries_batch_at'])}",
        f"경주 {meta['race_count']} · 출전마 {meta['runner_count']} · 경고 "
        + (", ".join(run.warnings) if run.warnings else "없음"),
    ]
    for race in pl["races"]:
        dist = f"{race['distance']}m" if race["distance"] else "거리 미상"
        lines.append(
            f"  {race['race_no']}R {race['start_time'] or '--:--'} {dist} "
            f"{race['grade'] or ''} · {race['field_size']}두 · {_consensus_text(race)}"
        )
        lines.extend(_rule_line(race, rr) for rr in race["rules"])
    if pl["headlines"]:
        lines.append("말 소식 헤드라인:")
        for h in pl["headlines"]:
            where = f"{h['race_no']}R [{h['chul_no']}] " if h["chul_no"] is not None else (
                f"{h['race_no']}R " if h["race_no"] is not None else ""
            )
            lines.append(f"  · {where}{h['text']}")
        if pl["headline_overflow"]:
            lines.append(f"  · 외 {pl['headline_overflow']}건")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# racing-form-show
# ---------------------------------------------------------------------------

_SHOW_EDITION = text(
    """
    SELECT e.id, e.race_date, e.meet, e.issue_no, e.rules_version, e.schema_version,
           e.history_before, e.results_through, e.entries_batch_at, e.freeze_at, e.deadline_at,
           e.published_at, e.created_at, e.race_count, e.runner_count, e.payload_sha256,
           e.payload
      FROM racing_form_editions e
     WHERE e.race_date = :d
       AND e.meet = :meet
    """
)
_SHOW_OUTCOMES = text(
    """
    SELECT race_no, status, starters, winners, placed, non_starters, extra_starters, favorites,
           results_digest, first_settled_at, settled_at, is_final, finalized_at
      FROM racing_form_race_outcomes
     WHERE edition_id = :id
     ORDER BY race_no
    """
)
# 그 호의 공지 + 그날의 호 없는 공지(missed·publish_failed) + 기간에 D 가 든 paused
_SHOW_NOTICES = text(
    """
    SELECT n.id, n.kind, n.meet, n.edition_id, n.public_text, n.detail, n.source, n.noticed_at
      FROM racing_form_notices n
     WHERE n.edition_id = CAST(:id AS bigint)
        OR (n.edition_id IS NULL AND n.kind <> 'paused' AND n.race_date = :d
            AND (n.meet IS NULL OR n.meet = :meet))
        OR (n.kind = 'paused' AND n.race_date <= :d AND n.detail ->> 'until' >= :d_text
            AND (n.meet IS NULL OR n.meet = :meet))
     ORDER BY n.noticed_at, n.id
    """
)
_FIND_EDITION = text(
    "SELECT id FROM racing_form_editions WHERE race_date = :d AND meet = :meet"
)


def _verdict_text(horse_no: str, outcome: Mapping[str, Any] | None) -> str:
    return _VERDICT[settle.pick_outcome(horse_no, outcome)]


def show_edition(
    d: date, meet: str, *, session_factory: SessionFactory | None = None
) -> tuple[str, bool]:
    """저장된 호 요약 → (출력, 발행본 있음). READ ONLY."""
    with queries.read_only_provider(session_factory) as sql:
        conn = sql.conn
        ed = conn.execute(_SHOW_EDITION, {"d": d, "meet": meet}).mappings().first()
        edition_id = int(ed["id"]) if ed is not None else None
        outcomes = (
            {
                int(r["race_no"]): dict(r)
                for r in conn.execute(_SHOW_OUTCOMES, {"id": edition_id}).mappings().all()
            }
            if edition_id is not None
            else {}
        )
        notices = [
            dict(r)
            for r in conn.execute(
                _SHOW_NOTICES,
                {"id": edition_id, "d": d, "d_text": d.isoformat(), "meet": meet},
            ).mappings().all()
        ]
    lines: list[str] = []
    if ed is None:
        lines.append(f"경마지 {ymd_ko(d)} {meet} — 발행본 없음")
    else:
        defn = definitions.RULE_SETS.get(ed["rules_version"])
        late = (
            " · 늦게 발행"
            if defn is not None and schedule.is_late(ed["published_at"], d, defn)
            else ""
        )
        pl = ed["payload"] if isinstance(ed["payload"], dict) else json.loads(ed["payload"])
        warnings = pl.get("edition", {}).get("warnings", [])
        final = sum(1 for o in outcomes.values() if o["is_final"])
        voids = sum(1 for o in outcomes.values() if o["status"] == settle.RACE_VOID)
        lines += [
            f"경마지 {ymd_ko(d)} {meet} · 제{ed['issue_no']}호 (id {edition_id}) · "
            f"{ed['rules_version']} · 발행 {_kst_text(ed['published_at'])}{late} · "
            f"해시 {ed['payload_sha256'][:12]}",
            f"동결 {_kst_text(ed['freeze_at'])} · 마감 {_kst_text(ed['deadline_at'])} · "
            f"H {ed['history_before']} (성적 반영 {ed['results_through'] or '-'}까지) · "
            f"출전표 배치 {_kst_text(ed['entries_batch_at'])} · "
            f"DB 기록 {_kst_text(ed['created_at'])}",
            f"경주 {ed['race_count']} · 출전마 {ed['runner_count']} · 경고 "
            + (", ".join(warnings) if warnings else "없음"),
            f"정산 {len(outcomes)}/{ed['race_count']}경주 (확정 {final} · 경주 무효 {voids})",
        ]
        for race in pl.get("races", []):
            race_no = int(race["race_no"])
            o = outcomes.get(race_no)
            if o is None:
                res = "정산 전"
            elif o["status"] == settle.RACE_VOID:
                res = "경주 무효" + (" (확정)" if o["is_final"] else " (잠정)")
            else:
                wins = " ".join(_horse_label(race, h) for h in o["winners"]) or "-"
                res = f"1착 {wins}" + (" (확정)" if o["is_final"] else " (잠정)")
            cons = race["consensus"]
            top = next((p for p in cons["picks"] if p["mark"] == 1), None)
            cons_text = _consensus_text(race)
            if top is not None:
                cons_text += f" → {_verdict_text(top['horse_no'], o)}"
            lines.append(f"  {race_no}R · {res} · {cons_text}")
            parts = []
            for rr in race["rules"]:
                label = RULE_LABELS.get(rr["key"], rr["key"])
                if rr["status"] != "picked":
                    parts.append(f"{label} 예상 안 함")
                    continue
                marks = " ".join(
                    f"{_MARK[p['mark']]}[{p['chul_no']}]{_verdict_text(p['horse_no'], o)}"
                    for p in rr["picks"]
                )
                parts.append(f"{label} {marks}")
            lines.append("    " + " | ".join(parts))
    if notices:
        lines.append(f"공지 {len(notices)}건:")
        for n in notices:
            extra = ""
            detail = n["detail"] or {}
            if n["kind"] == "paused":
                extra = f" (~{detail.get('until')})"
            if detail.get("hide_picks") is True:
                extra += " (예상 숨김)"
            lines.append(
                f"  [{n['kind']}] {_kst_text(n['noticed_at'])} {n['source']} "
                f"{n['meet'] or '전체'}{extra} — {n['public_text']}"
            )
    else:
        lines.append("공지 없음")
    return "\n".join(lines), ed is not None


# ---------------------------------------------------------------------------
# racing-form-settle
# ---------------------------------------------------------------------------


class _OneDayRepo:
    """정산 대상을 한 경주일로 좁히는 Repo 래퍼 (나머지 동작은 그대로)."""

    def __init__(self, inner: Any, d: date) -> None:
        self._inner = inner
        self._d = d

    def editions_for_settlement(self, d_from: date, d_to: date) -> list[store.EditionRef]:
        return self._inner.editions_for_settlement(self._d, self._d)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def settle_once(
    now: datetime,
    *,
    d: date | None = None,
    repo: Any | None = None,
    provider: Any | None = None,
) -> tuple[int, list[str]]:
    """정산 잡(settle_racing_form)을 그대로 1회 — d 가 있으면 그 경주일 발행본만."""
    from ..jobs.racing_form_jobs import settle_racing_form

    repo_: Any = repo if repo is not None else store.SqlRepo()
    if d is not None:
        repo_ = _OneDayRepo(repo_, d)
    return settle_racing_form(now, repo=repo_, provider=provider)


# ---------------------------------------------------------------------------
# racing-form-notice
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class NoticeResult:
    inserted: bool
    kind: str
    dedup_key: str
    edition_id: int | None
    messages: list[str]


def find_edition_id(
    d: date, meet: str, *, session_factory: SessionFactory | None = None
) -> int | None:
    with queries.read_only_provider(session_factory) as sql:
        v = sql.conn.execute(_FIND_EDITION, {"d": d, "meet": meet}).scalar()
    return int(v) if v is not None else None


def add_operator_notice(
    *,
    kind: str,
    d: date,
    meet: str | None,
    public_text: str,
    now: datetime,
    until: date | None = None,
    hide_picks: bool = False,
    repo: Any | None = None,
    session_factory: SessionFactory | None = None,
) -> NoticeResult:
    """운영자 공지 추가 (계약 §7). 잘못된 조합은 ValueError — DB 에 아무것도 쓰지 않는다."""
    if kind not in OPERATOR_KINDS:
        raise ValueError(f"--kind 는 erratum · withdrawn · paused ({kind!r})")
    body = str(public_text or "").strip()
    if not body:
        raise ValueError("--text 가 비어 있다")
    if hide_picks and kind != "withdrawn":
        raise ValueError("--hide-picks 는 withdrawn(법적 사유)에만 쓴다")
    edition_id: int | None = None
    detail: dict[str, Any] = {}
    messages: list[str] = []
    if kind in ("erratum", "withdrawn"):
        if meet is None:
            raise ValueError(f"{kind} 공지는 --meet 가 필요하다 (호 = 경주일 + 경마장)")
        if until is not None:
            raise ValueError("--until 은 paused 에만 쓴다")
        edition_id = find_edition_id(d, meet, session_factory=session_factory)
        if edition_id is None:
            raise ValueError(f"{d.isoformat()} {meet} 발행본이 없다 — {kind} 는 발행본에만 붙인다")
        if hide_picks:
            detail["hide_picks"] = True
        dedup = store.operator_notice_key(kind, d, meet, body)
        if kind == "withdrawn":
            messages.append("철회해도 이 호의 예상은 기록(적중 집계)에 그대로 포함됩니다.")
            messages.append(
                "화면은 예상을 그대로 보이고 '철회됨' 배너를 단다"
                + (" — --hide-picks 라 예상은 숨긴다 (집계는 유지)." if hide_picks else ".")
            )
            messages.append("같은 (경주일, 경마장)은 다시 발행할 수 없다.")
        else:
            messages.append(
                "정정은 예상·판정·집계를 바꾸지 않습니다 — 이 호는 기록에 그대로 포함됩니다."
            )
    else:  # paused
        if until is None:
            raise ValueError("paused 공지는 --until (종료일, 그날 포함)이 필요하다")
        if until < d:
            raise ValueError(f"--until({until}) 이 시작일({d}) 보다 앞이다")
        detail["until"] = until.isoformat()
        dedup = store.paused_key(d, meet, until)
        messages.append(
            f"{d.isoformat()} ~ {until.isoformat()} {meet or '전체 경마장'} 호는 "
            "발행·missed 처리하지 않습니다. 등록한 기간은 줄일 수 없으니 짧게 등록하세요."
        )
    repo_: Any = repo if repo is not None else store.SqlRepo(session_factory)
    inserted = repo_.record_notice(
        kind=kind,
        race_date=d,
        meet=meet,
        public_text=body,
        dedup_key=dedup,
        noticed_at=now,
        edition_id=edition_id,
        detail=detail,
        source="operator",
    )
    if not inserted:
        messages.insert(0, f"같은 공지가 이미 있어 추가하지 않았다 (dedup_key {dedup}).")
    return NoticeResult(inserted, kind, dedup, edition_id, messages)
