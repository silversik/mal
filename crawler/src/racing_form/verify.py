"""경마지 무결성 점검 (읽기 전용) — `racing-form-verify`. 계약 §5·§8.1(036)·계획 §8.2.

036 의 CHECK 는 잡이 넣은 값(published_at 등)만 본다. DB 시계·해시·트리거 상태·레지스트리는 여기서
점검한다 (PR-2 의 healthcheck '경마지 보호 장치' 행과 같은 뜻).

점검 (각각 READ ONLY 트랜잭션 하나 — 한 점검이 실패해도 나머지는 계속, 실패 자체가 문제로 남는다)
1. payload — 모든 발행본의 payload_sha256 을 SQL 로 다시 계산해 저장값과 비교,
   summary = payload.summary.
2. 시계 — |created_at(DB 시계) − published_at(잡 시계)| ≤ max_clock_skew (기본 5분).
3. 보호 트리거 — `starts_with(tgname, 'trg_rf_') AND NOT tgisinternal` 가 정확히 12개, 이름·테이블이
   036 과 같고 모두 tgenabled = 'A' (ENABLE ALWAYS).
4. 기준 정의 — racing_form_rule_sets 각 행의 definition_sha256 =
   definitions.RULE_SETS[버전] 의 해시,
   저장된 definition JSON = 레지스트리 JSON. 레지스트리에 없는 버전은 문제.
5. 예상 행 — racing_form_picks 가 payload 에서 만든 예상(기준 picks + 주목마)과 같다: 호마다 행 수와
   키(경주·기준·기호·마번·출전번호). picks 의 race_date·meet·rule_version 이 발행본과 같다.

현재 시각을 읽지 않는다 (DB 의 created_at 과 저장된 published_at 만 비교한다).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator, Sequence
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

from ..redact import redact
from . import definitions, queries
from .schedule import KST

#: 036 이 만드는 보호 트리거 12개 (이름 → 테이블)
EXPECTED_TRIGGERS: dict[str, str] = {
    "trg_rf_rule_sets_guard": "racing_form_rule_sets",
    "trg_rf_editions_guard": "racing_form_editions",
    "trg_rf_picks_guard": "racing_form_picks",
    "trg_rf_backtests_guard": "racing_form_backtests",
    "trg_rf_notices_guard": "racing_form_notices",
    "trg_rf_outcomes_guard": "racing_form_race_outcomes",
    "trg_rf_rule_sets_truncate": "racing_form_rule_sets",
    "trg_rf_editions_truncate": "racing_form_editions",
    "trg_rf_picks_truncate": "racing_form_picks",
    "trg_rf_outcomes_truncate": "racing_form_race_outcomes",
    "trg_rf_backtests_truncate": "racing_form_backtests",
    "trg_rf_notices_truncate": "racing_form_notices",
}

#: |created_at − published_at| 허용 (잡이 실제 시각으로 넣었다면 몇 초)
DEFAULT_MAX_CLOCK_SKEW = timedelta(minutes=5)

SessionFactory = Callable[[], AbstractContextManager[Any]]

_EDITIONS = text(
    """
    SELECT e.id,
           e.race_date,
           e.meet,
           e.rules_version,
           e.published_at,
           e.created_at,
           e.payload_sha256 = encode(sha256(convert_to(e.payload::text, 'UTF8')), 'hex')
               AS sha_ok,
           e.summary = e.payload -> 'summary' AS summary_ok
      FROM racing_form_editions e
     ORDER BY e.id
    """
)

_TRIGGERS = text(
    """
    SELECT t.tgname::text     AS name,
           c.relname::text    AS table_name,
           t.tgenabled::text  AS enabled
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
     WHERE starts_with(t.tgname::text, 'trg_rf_')
       AND NOT t.tgisinternal
     ORDER BY t.tgname
    """
)

_RULE_SETS = text(
    """
    SELECT rules_version, definition_sha256, definition
      FROM racing_form_rule_sets
     ORDER BY rules_version
    """
)

# payload 에서 다시 만든 예상 (기준 picks + 주목마) vs racing_form_picks — 호마다 행 수·차이 수
_PICKS = text(
    """
    WITH expected AS (
        SELECT e.id                          AS edition_id,
               (r.v ->> 'race_no')::int      AS race_no,
               x.v ->> 'key'                 AS rule_key,
               (p.v ->> 'mark')::int         AS mark,
               p.v ->> 'horse_no'            AS horse_no,
               (p.v ->> 'chul_no')::int      AS chul_no
          FROM racing_form_editions e
         CROSS JOIN LATERAL jsonb_array_elements(e.payload -> 'races') AS r(v)
         CROSS JOIN LATERAL jsonb_array_elements(r.v -> 'rules') AS x(v)
         CROSS JOIN LATERAL jsonb_array_elements(x.v -> 'picks') AS p(v)
         WHERE x.v ->> 'status' = 'picked'
        UNION ALL
        SELECT e.id,
               (r.v ->> 'race_no')::int,
               'consensus',
               (p.v ->> 'mark')::int,
               p.v ->> 'horse_no',
               (p.v ->> 'chul_no')::int
          FROM racing_form_editions e
         CROSS JOIN LATERAL jsonb_array_elements(e.payload -> 'races') AS r(v)
         CROSS JOIN LATERAL jsonb_array_elements(r.v -> 'consensus' -> 'picks') AS p(v)
    ),
    actual AS (
        SELECT edition_id, race_no, rule_key, mark::int AS mark, horse_no, chul_no
          FROM racing_form_picks
    ),
    missing AS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual),
    extra AS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected),
    ce AS (SELECT edition_id, COUNT(*) AS n FROM expected GROUP BY edition_id),
    ca AS (SELECT edition_id, COUNT(*) AS n FROM actual GROUP BY edition_id),
    cm AS (SELECT edition_id, COUNT(*) AS n FROM missing GROUP BY edition_id),
    cx AS (SELECT edition_id, COUNT(*) AS n FROM extra GROUP BY edition_id)
    SELECT e.id                      AS edition_id,
           e.race_date,
           e.meet,
           COALESCE(ce.n, 0)::int    AS expected,
           COALESCE(ca.n, 0)::int    AS actual,
           COALESCE(cm.n, 0)::int    AS missing,
           COALESCE(cx.n, 0)::int    AS extra
      FROM racing_form_editions e
      LEFT JOIN ce ON ce.edition_id = e.id
      LEFT JOIN ca ON ca.edition_id = e.id
      LEFT JOIN cm ON cm.edition_id = e.id
      LEFT JOIN cx ON cx.edition_id = e.id
     ORDER BY e.id
    """
)

_PICKS_META = text(
    """
    SELECT p.edition_id, COUNT(*)::int AS n
      FROM racing_form_picks p
      JOIN racing_form_editions e ON e.id = p.edition_id
     WHERE p.race_date <> e.race_date
        OR p.meet <> e.meet
        OR p.rule_version <> e.rules_version
     GROUP BY p.edition_id
     ORDER BY p.edition_id
    """
)


@dataclass(frozen=True)
class Problem:
    """점검에서 찾은 문제 하나.

    check: payload · clock · triggers · rule_sets · picks (그 점검이 실패해도 같은 이름).
    """

    check: str
    detail: str
    edition_id: int | None = None

    def __str__(self) -> str:
        where = f" (호 {self.edition_id})" if self.edition_id is not None else ""
        return f"[{self.check}]{where} {self.detail}"


@dataclass
class VerifyReport:
    """점검 결과 — 문제 목록 + 본 대상 수."""

    problems: list[Problem] = field(default_factory=list)
    editions: int = 0
    rule_sets: int = 0
    triggers: int = 0
    picks: int = 0

    @property
    def ok(self) -> bool:
        return not self.problems


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
    raise TypeError(f"verify: conn 은 Engine 또는 트랜잭션 팩토리여야 한다 ({conn!r})")


def _err(exc: BaseException) -> str:
    return " ".join(redact(f"{type(exc).__name__}: {exc}").split())[:300]


def _rows(factory: SessionFactory, sql: Any) -> list[dict[str, Any]]:
    with queries.read_only_provider(factory) as p:
        return [dict(r) for r in p.conn.execute(sql).mappings().all()]


def _check_editions(
    factory: SessionFactory, report: VerifyReport, max_clock_skew: timedelta
) -> None:
    rows = _rows(factory, _EDITIONS)
    report.editions = len(rows)
    for r in rows:
        label = f"{r['race_date']} {r['meet']}"
        if not r["sha_ok"]:
            report.problems.append(
                Problem("payload", f"{label} payload_sha256 가 SQL 재계산과 다름", r["id"])
            )
        if not r["summary_ok"]:
            report.problems.append(
                Problem("payload", f"{label} summary ≠ payload.summary", r["id"])
            )
        skew = abs(r["created_at"] - r["published_at"])
        if skew > max_clock_skew:
            report.problems.append(
                Problem(
                    "clock",
                    f"{label} created_at(DB) − published_at(잡) 차이 {_fmt_delta(skew)} "
                    f"(허용 {_fmt_delta(max_clock_skew)}) — published_at "
                    f"{_kst(r['published_at'])}, created_at {_kst(r['created_at'])}",
                    r["id"],
                )
            )


def _kst(dt: datetime) -> str:
    return dt.astimezone(KST).strftime("%Y-%m-%d %H:%M:%S KST")


def _fmt_delta(td: timedelta) -> str:
    secs = int(td.total_seconds())
    if secs < 120:
        return f"{secs}초"
    mins = secs // 60
    if mins < 120:
        return f"{mins}분"
    hours = mins // 60
    if hours < 48:
        return f"{hours}시간 {mins % 60}분"
    return f"{hours // 24}일 {hours % 24}시간"


def _check_triggers(factory: SessionFactory, report: VerifyReport) -> None:
    rows = _rows(factory, _TRIGGERS)
    report.triggers = len(rows)
    found = {r["name"]: r for r in rows}
    if len(rows) != len(EXPECTED_TRIGGERS):
        report.problems.append(
            Problem(
                "triggers",
                f"trg_rf_ 트리거 {len(rows)}개 (기대 {len(EXPECTED_TRIGGERS)}개)",
            )
        )
    missing = sorted(set(EXPECTED_TRIGGERS) - set(found))
    if missing:
        report.problems.append(Problem("triggers", f"없는 트리거: {', '.join(missing)}"))
    unknown = sorted(set(found) - set(EXPECTED_TRIGGERS))
    if unknown:
        report.problems.append(Problem("triggers", f"모르는 트리거: {', '.join(unknown)}"))
    for r in rows:
        want_table = EXPECTED_TRIGGERS.get(r["name"])
        if want_table is not None and r["table_name"] != want_table:
            report.problems.append(
                Problem(
                    "triggers",
                    f"{r['name']} 가 {r['table_name']} 에 붙어 있음 (기대 {want_table})",
                )
            )
        if r["enabled"] != "A":
            report.problems.append(
                Problem(
                    "triggers",
                    f"{r['name']} 상태 {r['enabled']!r} — ENABLE ALWAYS('A') 가 아님",
                )
            )


def _check_rule_sets(factory: SessionFactory, report: VerifyReport) -> None:
    rows = _rows(factory, _RULE_SETS)
    report.rule_sets = len(rows)
    for r in rows:
        version = r["rules_version"]
        defn = definitions.RULE_SETS.get(version)
        if defn is None:
            report.problems.append(
                Problem("rule_sets", f"{version}: 코드 레지스트리(RULE_SETS)에 없는 버전")
            )
            continue
        sha = definitions.definition_sha256(defn)
        if r["definition_sha256"] != sha:
            report.problems.append(
                Problem(
                    "rule_sets",
                    f"{version}: DB 정의 해시 {r['definition_sha256'][:12]} ≠ 코드 {sha[:12]}",
                )
            )
        stored = r["definition"]
        if isinstance(stored, str):
            stored = json.loads(stored)
        if stored != json.loads(definitions.definition_json(defn)):
            report.problems.append(
                Problem("rule_sets", f"{version}: 저장된 definition JSON 이 레지스트리와 다름")
            )


def _check_picks(factory: SessionFactory, report: VerifyReport) -> None:
    rows = _rows(factory, _PICKS)
    report.picks = sum(int(r["actual"]) for r in rows)
    for r in rows:
        if r["expected"] != r["actual"] or r["missing"] or r["extra"]:
            report.problems.append(
                Problem(
                    "picks",
                    f"{r['race_date']} {r['meet']} 예상 행 {r['actual']} (payload 기준 "
                    f"{r['expected']}) · 빠짐 {r['missing']} · 남음 {r['extra']}",
                    int(r["edition_id"]),
                )
            )
    for r in _rows(factory, _PICKS_META):
        report.problems.append(
            Problem(
                "picks",
                f"race_date·meet·rule_version 이 발행본과 다른 예상 행 {r['n']}개",
                int(r["edition_id"]),
            )
        )


def run_verify(
    conn: Any = None, *, max_clock_skew: timedelta = DEFAULT_MAX_CLOCK_SKEW
) -> VerifyReport:
    """전체 점검 → VerifyReport. conn: None(src.db.session_scope) · Engine · 트랜잭션 팩토리."""
    factory = _as_factory(conn)
    report = VerifyReport()
    steps: Sequence[tuple[str, Callable[[], None]]] = (
        ("payload", lambda: _check_editions(factory, report, max_clock_skew)),
        ("triggers", lambda: _check_triggers(factory, report)),
        ("rule_sets", lambda: _check_rule_sets(factory, report)),
        ("picks", lambda: _check_picks(factory, report)),
    )
    for name, fn in steps:
        try:
            fn()
        except Exception as e:  # 한 점검 실패가 나머지를 막지 않도록 — 실패도 문제로 남긴다
            report.problems.append(Problem(name, f"점검 실패 — {_err(e)}"))
    return report


def verify(
    conn: Any = None, *, max_clock_skew: timedelta = DEFAULT_MAX_CLOCK_SKEW
) -> list[Problem]:
    """문제 목록만 (없으면 [])."""
    return run_verify(conn, max_clock_skew=max_clock_skew).problems


def render_text(report: VerifyReport) -> str:
    head = (
        f"경마지 무결성 점검 · 발행본 {report.editions} · 예상 행 {report.picks} · "
        f"기준 정의 {report.rule_sets} · 보호 트리거 {report.triggers}/{len(EXPECTED_TRIGGERS)}"
    )
    if report.ok:
        return f"{head}\n문제 없음"
    lines = [head, f"문제 {len(report.problems)}건"]
    lines.extend(f"  {p}" for p in report.problems)
    return "\n".join(lines)
