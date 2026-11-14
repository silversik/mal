"""경마지(036) DB 보호 장치 — 트리거·CHECK·UNIQUE 를 실제 PostgreSQL 에서 확인.

`E2E_DATABASE_URL` 이 없으면 전부 skip. 대상은 tests/e2e/setup_db.sh 로 만든 prod 레이아웃 DB
(mal 스키마 + search_path=mal,public) 이고, 운영 호스트·이름에 e2e/test 가 없는 DB 는
tests/e2e/conftest.py 와 같은 규칙으로 거부한다.

- 테스트 하나 = 트랜잭션 하나, 끝나면 무조건 ROLLBACK (커밋하지 않는다). 거부돼야 하는 문장은
  SAVEPOINT 안에서 실행해 바깥 트랜잭션을 계속 쓴다 (`rejected`).
- 다른 세션이 같은 DB 를 써도 겹치지 않게 키(rules_version · meet · dedup_key · 정의 해시)는
  매번 새로 만든다 → (race_date, meet)·(meet, issue_no) UNIQUE 와 부딪히지 않는다.
- 발행 창 CHECK 는 Python·웹과 공유하는 schedule_vectors.json 으로도 대조한다.

실행:
  E2E_DATABASE_URL=postgresql+psycopg://mal:mal_dev_pw@localhost:5432/mal_e2e \\
    uv run pytest -q tests/test_racing_form_db.py
"""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from functools import partial
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine, make_url
from sqlalchemy.exc import DBAPIError

from src.racing_form import definitions, schedule

E2E_URL = os.environ.get("E2E_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not E2E_URL, reason="E2E_DATABASE_URL 미설정 — tests/e2e/README.md 참고")

KST = ZoneInfo("Asia/Seoul")
R1 = definitions.RULE_SETS["r1"]
VECTORS: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "racing_form" / "schedule_vectors.json")
    .read_text(encoding="utf-8"))

D = date(2026, 11, 14)  # 토요일 — schedule_vectors 의 기본 경주일
US = timedelta(microseconds=1)  # timestamptz 해상도

TABLES = (
    "racing_form_rule_sets", "racing_form_editions", "racing_form_picks",
    "racing_form_race_outcomes", "racing_form_backtests", "racing_form_notices",
)

# 036 트리거 함수의 RAISE 문구 (일부)
APPEND_ONLY_MSG = "수정·삭제할 수 없습니다"
OUTCOME_FINAL_MSG = "확정된 경마지 정산은 바꿀 수 없습니다"
OUTCOME_DELETE_MSG = "경마지 정산은 삭제할 수 없습니다"
OUTCOME_KEY_MSG = "키·최초 정산 시각은 바꿀 수 없습니다"
TRUNCATE_MSG = "TRUNCATE 할 수 없습니다"


# ============================================================== 안전장치·연결


def _assert_safe_target(url: str) -> None:
    """tests/e2e/conftest.py 와 같은 규칙 — 운영 호스트, 이름에 e2e/test 없는 DB 거부."""
    u = make_url(url)
    if u.host and u.host.startswith("49.50.138."):
        pytest.exit("E2E_DATABASE_URL 이 운영 DB 를 가리킴 — 중단", returncode=2)
    name = (u.database or "").lower()
    if not ("e2e" in name or "test" in name) and os.environ.get("E2E_ALLOW_ANY_DB") != "1":
        pytest.exit(
            f"경마지 DB 테스트는 e2e/test DB 에서만 돈다 — DB 이름에 'e2e'/'test' 가 없으면 "
            f"거부 ({name!r}). 의도한 것이면 E2E_ALLOW_ANY_DB=1.",
            returncode=2,
        )


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    _assert_safe_target(E2E_URL)
    url = E2E_URL
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    eng = create_engine(url, future=True, pool_pre_ping=True)
    try:
        with eng.connect() as c:
            if not c.execute(text("SELECT to_regclass('mal.racing_form_editions') IS NOT NULL")
                             ).scalar():
                pytest.exit(
                    "mal.racing_form_editions 없음 — 036 미적용. tests/e2e/setup_db.sh 로 "
                    "DB 를 다시 만들 것",
                    returncode=2,
                )
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def conn(engine: Engine) -> Iterator[Connection]:
    """테스트 하나 = 트랜잭션 하나. 끝나면 무조건 ROLLBACK."""
    with engine.connect() as c:
        tx = c.begin()
        try:
            # 다른 세션이 잡은 락에 막혀 멈추지 않게 (TRUNCATE 는 ACCESS EXCLUSIVE)
            c.execute(text("SET LOCAL lock_timeout = '10s'"))
            c.execute(text("SET LOCAL statement_timeout = '60s'"))
            yield c
        finally:
            tx.rollback()


# ============================================================== 오류 확인 헬퍼


def rejected(conn: Connection, action: Callable[[], object]) -> Any:
    """action 을 SAVEPOINT 안에서 실행해 DB 가 거부하는지 확인 → psycopg 오류.

    SAVEPOINT 로 되돌리므로 바깥 트랜잭션은 계속 쓸 수 있다.
    """
    with pytest.raises(DBAPIError) as ei, conn.begin_nested():
        action()
    return ei.value.orig


def _desc(err: Any) -> str:
    return f"{err.sqlstate} {err.diag.constraint_name}: {err.diag.message_primary}"


def assert_check(conn: Connection, constraint: str | tuple[str, ...],
                 action: Callable[[], object]) -> None:
    names = constraint if isinstance(constraint, tuple) else (constraint,)
    err = rejected(conn, action)
    assert err.sqlstate == "23514" and err.diag.constraint_name in names, _desc(err)


def assert_unique(conn: Connection, constraint: str, action: Callable[[], object]) -> None:
    err = rejected(conn, action)
    assert (err.sqlstate, err.diag.constraint_name) == ("23505", constraint), _desc(err)


def assert_guard(conn: Connection, phrase: str, action: Callable[[], object]) -> str:
    """보호 트리거의 RAISE EXCEPTION(P0001) 이고 문구에 phrase 가 있는지 → 문구."""
    err = rejected(conn, action)
    msg = err.diag.message_primary or ""
    assert err.sqlstate == "P0001" and phrase in msg, _desc(err)
    return msg


def run(conn: Connection, sql: str, **params: Any) -> Callable[[], object]:
    """나중에 실행할 SQL 한 문장 (assert_* 에 넘긴다)."""
    return lambda: conn.execute(text(sql), params)


# ============================================================== 행 만들기


def _uid() -> str:
    return uuid.uuid4().hex[:10]


def _sha() -> str:
    """겹치지 않는 64자리 소문자 hex (정의 해시 자리)."""
    return hashlib.sha256(uuid.uuid4().bytes).hexdigest()


def dumps(obj: Any) -> str:
    """계약 §4 직렬화 — 정렬 키 · 한글 그대로 · 공백 없는 구분자."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _json(value: Any) -> str:
    """str 은 이미 JSON 텍스트로 보고 그대로, 그 밖은 dumps."""
    return value if isinstance(value, str) else dumps(value)


def at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime.combine(d, time(hh, mm), tzinfo=KST)


def new_meet() -> str:
    """테스트 전용 경마장 이름 (VARCHAR(20)) — 다른 세션의 호와 겹치지 않게."""
    return f"시험{_uid()}"


def _merge(row: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    unknown = set(over) - set(row)
    assert not unknown, f"모르는 열: {sorted(unknown)}"
    row.update(over)
    return row


FINAL_AT = at(D + timedelta(days=1), 13, 15)  # D+1 13:00 확정 이후의 정산 실행


@dataclass(frozen=True)
class Edition:
    id: int
    race_date: date
    meet: str
    rules_version: str


def add_rule_set(conn: Connection, definition_sha256: str | None = None) -> str:
    version = f"t-{_uid()}"
    definition = dumps({"version": version, "rules": ["rating", "form", "course", "jockey"]})
    if definition_sha256 is None:
        definition_sha256 = hashlib.sha256(definition.encode("utf-8")).hexdigest()
    conn.execute(text("""
        INSERT INTO racing_form_rule_sets (rules_version, definition, definition_sha256,
                                           registered_at)
        VALUES (:v, CAST(:d AS jsonb), :sha, :at)
    """), {"v": version, "d": definition, "sha": definition_sha256,
           "at": at(D - timedelta(days=2), 12)})
    return version


def make_payload(race_date: date, meet: str, rules_version: str) -> dict[str, Any]:
    """payload v1 뼈대 — DB 는 summary·해시만 본다 (한글 포함 → UTF8 변환 경로)."""
    h = race_date - timedelta(days=1)
    summary = {
        "schema_version": 1, "race_date": race_date.isoformat(), "meet": meet,
        "rules_version": rules_version, "race_count": 1, "runner_count": 5,
        "races": [{
            "race_no": 1, "race_name": "일반경주", "start_time": "10:35", "distance": 1200,
            "field_size": 5, "stakes": False,
            "consensus": {"status": "insufficient", "active_rules": 1, "pick": None},
        }],
        "counts": {"headlines": 0, "jockey_changes": 0, "debuts": 0, "class_changes": 0},
    }
    return {
        "schema_version": 1,
        "edition": {
            "race_date": race_date.isoformat(), "meet": meet, "rules_version": rules_version,
            "history_before": h.isoformat(), "results_through": None, "entries_batch_at": None,
            "freeze_at": at(h, 18).isoformat(), "warnings": [],
        },
        "rules": [], "races": [], "headlines": [], "headline_overflow": 0,
        "summary": summary,
    }


# summary 를 주지 않으면 CAST(:payload AS jsonb) -> 'summary', payload_sha256 을 주지 않으면
# 같은 CAST(:payload AS jsonb) 로 SQL 에서 계산 (계약 §4 — 해시는 SQL 에서만).
_EDITION_SQL = """
    INSERT INTO racing_form_editions (
        race_date, meet, issue_no, rules_version, schema_version, history_before,
        results_through, entries_batch_at, freeze_at, deadline_at, published_at,
        race_count, runner_count, summary, payload, payload_sha256)
    VALUES (
        :race_date, :meet, :issue_no, :rules_version, :schema_version, :history_before,
        :results_through, :entries_batch_at, :freeze_at, :deadline_at, :published_at,
        :race_count, :runner_count,
        COALESCE(CAST(:summary AS jsonb), CAST(:payload AS jsonb) -> 'summary'),
        CAST(:payload AS jsonb),
        COALESCE(CAST(:payload_sha256 AS text),
                 encode(sha256(convert_to(CAST(:payload AS jsonb)::text, 'UTF8')), 'hex')))
    RETURNING id
"""


def add_edition(conn: Connection, **over: Any) -> Edition:
    """유효한 발행본 1행 — D-1 18:00 KST 동결 · D 08:00 마감 · 18:00:42 발행.

    over 로 열을 하나씩 바꾼다 (payload·summary 는 dict/list 또는 JSON 텍스트).
    rules_version 을 주지 않으면 기준 정의 행을 새로 만든다.
    """
    d = over.pop("race_date", D)
    meet = over.pop("meet", None) or new_meet()
    rules_version = over.pop("rules_version", None) or add_rule_set(conn)
    freeze = at(d - timedelta(days=1), 18)
    row = _merge({
        "race_date": d, "meet": meet, "issue_no": 1, "rules_version": rules_version,
        "schema_version": 1, "history_before": d - timedelta(days=1),
        "results_through": d - timedelta(days=6), "entries_batch_at": freeze - timedelta(hours=6),
        "freeze_at": freeze, "deadline_at": at(d, 8),
        "published_at": freeze + timedelta(seconds=42),
        "race_count": 1, "runner_count": 5,
        "summary": None, "payload": make_payload(d, meet, rules_version), "payload_sha256": None,
    }, over)
    row["payload"] = _json(row["payload"])
    if row["summary"] is not None:
        row["summary"] = _json(row["summary"])
    new_id = conn.execute(text(_EDITION_SQL), row).scalar_one()
    return Edition(new_id, d, meet, rules_version)


def add_pick(conn: Connection, ed: Edition, **over: Any) -> int:
    row = _merge({
        "edition_id": ed.id, "race_date": ed.race_date, "meet": ed.meet, "race_no": 1,
        "rule_key": "rating", "rule_version": ed.rules_version, "mark": 1,
        "horse_no": "0041001", "chul_no": 1, "horse_name": "녹색신호", "votes": None,
        "reason": "레이팅 72 · 출전마 중 1위",
    }, over)
    return conn.execute(text("""
        INSERT INTO racing_form_picks (edition_id, race_date, meet, race_no, rule_key,
            rule_version, mark, horse_no, chul_no, horse_name, votes, reason)
        VALUES (:edition_id, :race_date, :meet, :race_no, :rule_key, :rule_version, :mark,
            :horse_no, :chul_no, :horse_name, :votes, :reason)
        RETURNING id
    """), row).scalar_one()


_OUTCOME_SQL = """
    INSERT INTO racing_form_race_outcomes (
        edition_id, race_no, race_date, status, starters, finish, winners, placed,
        results_digest, first_settled_at, settled_at, is_final, finalized_at)
    VALUES (
        :edition_id, :race_no, :race_date, :status, :starters, CAST(:finish AS jsonb),
        CAST(:winners AS text[]), CAST(:placed AS text[]),
        :results_digest, :first_settled_at, :settled_at, :is_final, :finalized_at)
"""


def outcome_row(ed: Edition, **over: Any) -> dict[str, Any]:
    t = at(ed.race_date, 13, 15)
    row = _merge({
        "edition_id": ed.id, "race_no": 1, "race_date": ed.race_date, "status": "official",
        "starters": 5,
        "finish": [{"horse_no": "0041001", "chul_no": 1, "rank": 1, "time_tenths": 728}],
        "winners": ["0041001"], "placed": ["0041001", "0041002", "0041003"],
        "results_digest": "d0", "first_settled_at": t, "settled_at": t,
        "is_final": False, "finalized_at": None,
    }, over)
    row["finish"] = _json(row["finish"])
    return row


def add_outcome(conn: Connection, ed: Edition, **over: Any) -> None:
    conn.execute(text(_OUTCOME_SQL), outcome_row(ed, **over))


def add_backtest(conn: Connection, **over: Any) -> int:
    """report_sha256 을 주지 않으면 같은 CAST(:report AS jsonb) 로 SQL 에서 계산."""
    row = _merge({
        "candidate_version": f"r1-cand-{_uid()}", "definition_sha256": _sha(), "label": "dev",
        "period_from": date(2025, 1, 1), "period_to": date(2025, 12, 31),
        "meets": ["서울", "부경"],
        "report": {"rules": {"rating": {"n": 120, "wins": 31}}, "메모": "과거 시험"},
        "report_sha256": None, "code_rev": "abc1234",
        "computed_at": at(D - timedelta(days=30), 3, 30),
    }, over)
    row["report"] = _json(row["report"])
    return conn.execute(text("""
        INSERT INTO racing_form_backtests (candidate_version, definition_sha256, label,
            period_from, period_to, meets, report, report_sha256, code_rev, computed_at)
        VALUES (:candidate_version, :definition_sha256, :label, :period_from, :period_to,
            CAST(:meets AS text[]), CAST(:report AS jsonb),
            COALESCE(CAST(:report_sha256 AS text),
                     encode(sha256(convert_to(CAST(:report AS jsonb)::text, 'UTF8')), 'hex')),
            :code_rev, :computed_at)
        RETURNING id
    """), row).scalar_one()


def add_notice(conn: Connection, **over: Any) -> int:
    """기본은 missed. kind=paused 이면 detail 기본값에 until 을 넣는다."""
    kind = over.get("kind", "missed")
    row = _merge({
        "race_date": D, "meet": new_meet(), "edition_id": None, "kind": kind,
        "public_text": "이번 호는 발행하지 못했습니다.",
        "detail": {"until": "2026-11-30"} if kind == "paused" else {},
        "source": "job", "noticed_at": at(D, 8), "dedup_key": f"test|{kind}|{_uid()}",
    }, over)
    row["detail"] = _json(row["detail"])
    return conn.execute(text("""
        INSERT INTO racing_form_notices (race_date, meet, edition_id, kind, public_text, detail,
            source, noticed_at, dedup_key)
        VALUES (:race_date, :meet, :edition_id, :kind, :public_text, CAST(:detail AS jsonb),
            :source, :noticed_at, :dedup_key)
        RETURNING id
    """), row).scalar_one()


# 추가 전용 5개 테이블 — 행 하나를 만들고 (WHERE 절, 파라미터) 를 돌려준다
def _seed_rule_set(conn: Connection) -> tuple[str, dict[str, Any]]:
    return "rules_version = :k", {"k": add_rule_set(conn)}


def _seed_edition(conn: Connection) -> tuple[str, dict[str, Any]]:
    return "id = :k", {"k": add_edition(conn).id}


def _seed_pick(conn: Connection) -> tuple[str, dict[str, Any]]:
    return "id = :k", {"k": add_pick(conn, add_edition(conn))}


def _seed_backtest(conn: Connection) -> tuple[str, dict[str, Any]]:
    return "id = :k", {"k": add_backtest(conn)}


def _seed_notice(conn: Connection) -> tuple[str, dict[str, Any]]:
    return "id = :k", {"k": add_notice(conn)}


APPEND_ONLY_SEEDS: dict[str, Callable[[Connection], tuple[str, dict[str, Any]]]] = {
    "racing_form_rule_sets": _seed_rule_set,
    "racing_form_editions": _seed_edition,
    "racing_form_picks": _seed_pick,
    "racing_form_backtests": _seed_backtest,
    "racing_form_notices": _seed_notice,
}


# ============================================================== 설치 상태 (카탈로그)

_GUARD = ("BEFORE", "ROW", ("DELETE", "UPDATE"))
_NO_TRUNCATE = ("BEFORE", "STATEMENT", ("TRUNCATE",))

EXPECTED_TRIGGERS = {
    "trg_rf_rule_sets_guard": ("racing_form_rule_sets", "racing_form_append_only", _GUARD),
    "trg_rf_editions_guard": ("racing_form_editions", "racing_form_append_only", _GUARD),
    "trg_rf_picks_guard": ("racing_form_picks", "racing_form_append_only", _GUARD),
    "trg_rf_backtests_guard": ("racing_form_backtests", "racing_form_append_only", _GUARD),
    "trg_rf_notices_guard": ("racing_form_notices", "racing_form_append_only", _GUARD),
    "trg_rf_outcomes_guard": ("racing_form_race_outcomes", "racing_form_outcome_guard", _GUARD),
    "trg_rf_rule_sets_truncate": ("racing_form_rule_sets", "racing_form_no_truncate",
                                  _NO_TRUNCATE),
    "trg_rf_editions_truncate": ("racing_form_editions", "racing_form_no_truncate",
                                 _NO_TRUNCATE),
    "trg_rf_picks_truncate": ("racing_form_picks", "racing_form_no_truncate", _NO_TRUNCATE),
    "trg_rf_outcomes_truncate": ("racing_form_race_outcomes", "racing_form_no_truncate",
                                 _NO_TRUNCATE),
    "trg_rf_backtests_truncate": ("racing_form_backtests", "racing_form_no_truncate",
                                  _NO_TRUNCATE),
    "trg_rf_notices_truncate": ("racing_form_notices", "racing_form_no_truncate", _NO_TRUNCATE),
}


def _decode_tgtype(tgtype: int) -> tuple[str, str, tuple[str, ...]]:
    """pg_trigger.tgtype 비트 (catalog/pg_trigger.h) → (시점, 단위, 이벤트)."""
    timing = "INSTEAD OF" if tgtype & 64 else ("BEFORE" if tgtype & 2 else "AFTER")
    level = "ROW" if tgtype & 1 else "STATEMENT"
    events = tuple(name for bit, name in ((4, "INSERT"), (8, "DELETE"), (16, "UPDATE"),
                                          (32, "TRUNCATE")) if tgtype & bit)
    return timing, level, events


def test_twelve_guard_triggers_installed_enable_always(conn: Connection) -> None:
    # LIKE 'trg_rf_%' 의 '_' 는 한 글자 와일드카드라 starts_with 로 센다
    rows = conn.execute(text("""
        SELECT t.tgname, c.relname, cn.nspname AS rel_schema, p.proname,
               pn.nspname AS fn_schema, t.tgenabled, t.tgtype
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace cn ON cn.oid = c.relnamespace
          JOIN pg_proc p ON p.oid = t.tgfoid
          JOIN pg_namespace pn ON pn.oid = p.pronamespace
         WHERE NOT t.tgisinternal AND starts_with(t.tgname, 'trg_rf_')
    """)).mappings().all()
    assert len(rows) == 12
    got = {r["tgname"]: (r["relname"], r["proname"], _decode_tgtype(r["tgtype"])) for r in rows}
    assert got == EXPECTED_TRIGGERS
    assert {(r["rel_schema"], r["fn_schema"]) for r in rows} == {("mal", "mal")}
    # 'A' = ENABLE ALWAYS — session_replication_role=replica 에서도 동작
    assert {r["tgname"]: r["tgenabled"] for r in rows} == dict.fromkeys(EXPECTED_TRIGGERS, "A")


def test_guard_functions_live_in_mal_schema(conn: Connection) -> None:
    """함수는 스키마 미수식 → search_path=mal,public 에서 mal 에 생긴다 (`pg_dump -n mal` 포함)."""
    rows = conn.execute(text("""
        SELECT p.proname, n.nspname, l.lanname, p.prorettype::regtype::text
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          JOIN pg_language l ON l.oid = p.prolang
         WHERE p.proname IN ('racing_form_append_only', 'racing_form_outcome_guard',
                             'racing_form_no_truncate')
    """)).all()
    assert sorted(tuple(r) for r in rows) == [
        ("racing_form_append_only", "mal", "plpgsql", "trigger"),
        ("racing_form_no_truncate", "mal", "plpgsql", "trigger"),
        ("racing_form_outcome_guard", "mal", "plpgsql", "trigger"),
    ]


# ============================================================== 추가 전용 (UPDATE·DELETE)


@pytest.mark.parametrize("table", list(APPEND_ONLY_SEEDS))
def test_append_only_tables_reject_update_and_delete(conn: Connection, table: str) -> None:
    where, key = APPEND_ONLY_SEEDS[table](conn)
    msg = assert_guard(conn, APPEND_ONLY_MSG, run(
        conn, f"UPDATE {table} SET created_at = created_at + interval '1 second' WHERE {where}",
        **key))
    assert f"({table} UPDATE)" in msg
    # 값이 그대로인 UPDATE 도 거부 (행 트리거는 바뀐 열을 보지 않는다)
    assert_guard(conn, APPEND_ONLY_MSG, run(
        conn, f"UPDATE {table} SET created_at = created_at WHERE {where}", **key))
    msg = assert_guard(conn, APPEND_ONLY_MSG, run(conn, f"DELETE FROM {table} WHERE {where}",
                                                  **key))
    assert f"({table} DELETE)" in msg
    assert conn.execute(text(f"SELECT count(*) FROM {table} WHERE {where}"), key).scalar() == 1


# ============================================================== 정산 (race_outcomes)


def _outcome(conn: Connection, ed: Edition, race_no: int) -> dict[str, Any]:
    return dict(conn.execute(text("""
        SELECT results_digest, winners, settled_at, first_settled_at, is_final, finalized_at
          FROM racing_form_race_outcomes WHERE edition_id = :e AND race_no = :r
    """), {"e": ed.id, "r": race_no}).mappings().one())


def test_outcome_provisional_update_allowed_until_final(conn: Connection) -> None:
    ed = add_edition(conn)
    t0 = at(D, 13, 15)
    add_outcome(conn, ed, first_settled_at=t0, settled_at=t0, results_digest="d1")
    # 잠정 → 결과 정정 반영 (digest·착순 변경)
    t1 = at(D, 22, 45)
    conn.execute(text("""
        UPDATE racing_form_race_outcomes
           SET settled_at = :t, results_digest = 'd2', winners = ARRAY['0041002'],
               placed = ARRAY['0041002', '0041001', '0041003']
         WHERE edition_id = :e AND race_no = 1
    """), {"t": t1, "e": ed.id})
    # D+1 13:00 이후 확정 (is_final false → true 전환 자체는 허용)
    conn.execute(text("""
        UPDATE racing_form_race_outcomes SET is_final = true, finalized_at = :t, settled_at = :t
         WHERE edition_id = :e AND race_no = 1
    """), {"t": FINAL_AT, "e": ed.id})
    assert _outcome(conn, ed, 1) == {
        "results_digest": "d2", "winners": ["0041002"], "settled_at": FINAL_AT,
        "first_settled_at": t0, "is_final": True, "finalized_at": FINAL_AT,
    }
    # 확정 뒤에는 거부
    assert_guard(conn, OUTCOME_FINAL_MSG, run(
        conn, "UPDATE racing_form_race_outcomes SET results_digest = 'd3' WHERE edition_id = :e",
        e=ed.id))


@pytest.mark.parametrize("set_clause", [
    "settled_at = settled_at + interval '1 minute'",
    "results_digest = 'changed', winners = ARRAY['0041003']",
    "is_final = false, finalized_at = NULL",  # 확정 취소
    "settled_at = settled_at",  # 값이 그대로여도
], ids=["settled_at", "result", "unfinalize", "noop"])
def test_outcome_final_row_rejects_update(conn: Connection, set_clause: str) -> None:
    ed = add_edition(conn)
    add_outcome(conn, ed, is_final=True, finalized_at=FINAL_AT, results_digest="d1")
    assert_guard(conn, OUTCOME_FINAL_MSG, run(
        conn, f"UPDATE racing_form_race_outcomes SET {set_clause} WHERE edition_id = :e",
        e=ed.id))
    assert _outcome(conn, ed, 1)["results_digest"] == "d1"


@pytest.mark.parametrize("is_final", [False, True], ids=["provisional", "final"])
def test_outcome_delete_always_rejected(conn: Connection, is_final: bool) -> None:
    ed = add_edition(conn)
    add_outcome(conn, ed, is_final=is_final, finalized_at=FINAL_AT if is_final else None)
    assert_guard(conn, OUTCOME_DELETE_MSG, run(
        conn, "DELETE FROM racing_form_race_outcomes WHERE edition_id = :e", e=ed.id))


@pytest.mark.parametrize("set_clause", [
    "edition_id = :other",
    "race_no = race_no + 1",
    "race_date = race_date + 1",
    "first_settled_at = first_settled_at + interval '1 minute'",
], ids=["edition_id", "race_no", "race_date", "first_settled_at"])
def test_outcome_key_and_first_settled_at_immutable(conn: Connection, set_clause: str) -> None:
    ed = add_edition(conn)
    other = add_edition(conn, rules_version=ed.rules_version)  # FK 는 만족하는 다른 호
    add_outcome(conn, ed)  # 잠정 행이어도
    params: dict[str, Any] = {"e": ed.id}
    if ":other" in set_clause:
        params["other"] = other.id
    assert_guard(conn, OUTCOME_KEY_MSG, run(
        conn, f"UPDATE racing_form_race_outcomes SET {set_clause} WHERE edition_id = :e",
        **params))


def test_outcome_upsert_goes_through_same_guard(conn: Connection) -> None:
    """정산 잡의 INSERT … ON CONFLICT DO UPDATE 도 BEFORE UPDATE 트리거를 탄다."""
    ed = add_edition(conn)
    add_outcome(conn, ed, race_no=1, results_digest="p1")  # 잠정
    add_outcome(conn, ed, race_no=2, results_digest="f1", is_final=True, finalized_at=FINAL_AT)
    on_conflict = _OUTCOME_SQL + " ON CONFLICT (edition_id, race_no) DO "
    later = at(D, 22, 45)
    # 잠정 행: 내용 갱신은 허용
    new1 = outcome_row(ed, race_no=1, results_digest="p2", first_settled_at=later,
                       settled_at=later)
    conn.execute(text(on_conflict + "UPDATE SET results_digest = EXCLUDED.results_digest, "
                      "settled_at = EXCLUDED.settled_at"), new1)
    # first_settled_at 을 EXCLUDED 로 덮으면 거부 — upsert 의 SET 에 넣으면 안 된다
    assert_guard(conn, OUTCOME_KEY_MSG, run(
        conn, on_conflict + "UPDATE SET first_settled_at = EXCLUDED.first_settled_at", **new1))
    # 확정 행: DO UPDATE 는 거부, DO NOTHING · WHERE NOT is_final 은 조용히 건너뜀
    new2 = outcome_row(ed, race_no=2, results_digest="f2", first_settled_at=later,
                       settled_at=later)
    assert_guard(conn, OUTCOME_FINAL_MSG, run(
        conn, on_conflict + "UPDATE SET results_digest = EXCLUDED.results_digest", **new2))
    conn.execute(text(on_conflict + "NOTHING"), new2)
    conn.execute(text(on_conflict + "UPDATE SET results_digest = EXCLUDED.results_digest "
                      "WHERE NOT racing_form_race_outcomes.is_final"), new2)
    got = {r: _outcome(conn, ed, r) for r in (1, 2)}
    assert (got[1]["results_digest"], got[1]["first_settled_at"]) == ("p2", at(D, 13, 15))
    assert (got[2]["results_digest"], got[2]["is_final"]) == ("f1", True)


def test_outcome_checks(conn: Connection) -> None:
    ed = add_edition(conn)
    # 확정이면 finalized_at 필수
    assert_check(conn, "ck_rf_outcome_final",
                 partial(add_outcome, conn, ed, is_final=True, finalized_at=None))
    for bad in ("cancelled", "void", "OFFICIAL"):
        assert_check(conn, "ck_rf_outcome_status", partial(add_outcome, conn, ed, status=bad))
    assert_check(conn, "ck_rf_outcome_starters", partial(add_outcome, conn, ed, starters=-1))
    add_outcome(conn, ed, race_no=1, status="official")
    add_outcome(conn, ed, race_no=2, status="race_void", starters=0, finish=[], winners=[],
                placed=[])
    # 잠정 → 확정 전환에도 finalized_at 필요 (트리거는 통과, CHECK 가 거부)
    assert_check(conn, "ck_rf_outcome_final", run(
        conn, "UPDATE racing_form_race_outcomes SET is_final = true "
              "WHERE edition_id = :e AND race_no = 1", e=ed.id))
    # 경주당 1행
    assert_unique(conn, "racing_form_race_outcomes_pkey",
                  partial(add_outcome, conn, ed, race_no=1))


def test_child_rows_need_existing_edition(conn: Connection) -> None:
    ghost = Edition(-1, D, new_meet(), add_rule_set(conn))
    for action in (partial(add_pick, conn, ghost), partial(add_outcome, conn, ghost),
                   partial(add_notice, conn, kind="erratum", edition_id=-1)):
        err = rejected(conn, action)
        assert err.sqlstate == "23503", _desc(err)  # foreign_key_violation


# ============================================================== TRUNCATE · replica


@pytest.mark.parametrize("table", TABLES)
def test_truncate_rejected_without_guc(conn: Connection, table: str) -> None:
    # rule_sets·editions 는 FK 로 참조돼 RESTRICT 면 트리거 전에 FK 오류가 난다 → CASCADE.
    # 명시한 테이블의 트리거가 먼저 돌아 문구에 그 이름이 나온다.
    msg = assert_guard(conn, TRUNCATE_MSG, run(conn, f"TRUNCATE {table} CASCADE"))
    assert f"({table})" in msg


@pytest.mark.parametrize("value", ["off", "true", ""])
def test_truncate_guc_must_be_exactly_on(conn: Connection, value: str) -> None:
    conn.execute(text("SELECT set_config('mal.racing_form_allow_truncate', :v, true)"),
                 {"v": value})
    assert_guard(conn, TRUNCATE_MSG, run(conn, "TRUNCATE racing_form_notices"))


def test_truncate_allowed_with_set_local_guc(conn: Connection) -> None:
    """tests/e2e/conftest.py 와 같은 문장 — GUC 없이는 거부, SET LOCAL 'on' 이면 통과.

    fixture 가 ROLLBACK 하므로 다른 세션의 행도 그대로 돌아온다.
    """
    ed = add_edition(conn)
    add_pick(conn, ed)
    add_outcome(conn, ed)
    add_backtest(conn)
    add_notice(conn)
    stmt = f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"
    assert_guard(conn, TRUNCATE_MSG, run(conn, stmt))
    conn.execute(text("SET LOCAL mal.racing_form_allow_truncate = 'on'"))
    conn.execute(text(stmt))
    counts = {t: conn.execute(text(f"SELECT count(*) FROM {t}")).scalar() for t in TABLES}
    assert counts == dict.fromkeys(TABLES, 0)


def test_truncate_guc_does_not_outlive_its_transaction(engine: Engine) -> None:
    """SET LOCAL 허용은 그 트랜잭션에서 끝난다 — 풀로 돌아간 연결은 다시 막힌다."""
    with engine.connect() as c:
        with c.begin():  # 데이터 변경 없이 커밋 (conftest 의 engine.begin() 과 같은 흐름)
            c.execute(text("SET LOCAL mal.racing_form_allow_truncate = 'on'"))
        tx = c.begin()
        try:
            c.execute(text("SET LOCAL lock_timeout = '10s'"))
            assert c.execute(text(
                "SELECT current_setting('mal.racing_form_allow_truncate', true)")).scalar() in (
                None, "")
            assert_guard(c, TRUNCATE_MSG, run(c, "TRUNCATE racing_form_notices"))
        finally:
            tx.rollback()


def test_replica_role_does_not_bypass_guards(conn: Connection) -> None:
    """e2e test_23 이 쓰는 session_replication_role=replica 로도 꺼지지 않는다 (ENABLE ALWAYS)."""
    seeded = {table: seed(conn) for table, seed in APPEND_ONLY_SEEDS.items()}
    ed = add_edition(conn)
    ghost = Edition(-1, D, new_meet(), ed.rules_version)  # 없는 호
    add_outcome(conn, ed, race_no=1)  # 잠정
    add_outcome(conn, ed, race_no=2, is_final=True, finalized_at=FINAL_AT)
    try:
        with conn.begin_nested():
            conn.execute(text("SET LOCAL session_replication_role = replica"))
    except DBAPIError as e:
        if getattr(e.orig, "sqlstate", None) == "42501":
            pytest.skip("session_replication_role 변경 권한 없음 (superuser 필요)")
        raise
    assert conn.execute(text("SHOW session_replication_role")).scalar() == "replica"
    # 대조군: 보통(ORIGIN) 트리거인 FK 검사는 replica 에서 꺼진다 → 없는 호를 가리켜도 들어감
    add_pick(conn, ghost)

    for table, (where, key) in seeded.items():
        assert_guard(conn, APPEND_ONLY_MSG, run(
            conn, f"UPDATE {table} SET created_at = created_at WHERE {where}", **key))
        assert_guard(conn, APPEND_ONLY_MSG, run(conn, f"DELETE FROM {table} WHERE {where}",
                                                **key))
    assert_guard(conn, OUTCOME_FINAL_MSG, run(
        conn, "UPDATE racing_form_race_outcomes SET results_digest = 'x' "
              "WHERE edition_id = :e AND race_no = 2", e=ed.id))
    assert_guard(conn, OUTCOME_KEY_MSG, run(
        conn, "UPDATE racing_form_race_outcomes SET race_no = 3 "
              "WHERE edition_id = :e AND race_no = 1", e=ed.id))
    assert_guard(conn, OUTCOME_DELETE_MSG, run(
        conn, "DELETE FROM racing_form_race_outcomes WHERE edition_id = :e", e=ed.id))
    assert_guard(conn, TRUNCATE_MSG, run(conn, f"TRUNCATE {', '.join(TABLES)} CASCADE"))


# ============================================================== 발행본 CHECK


@pytest.mark.parametrize("vec", VECTORS["dates"], ids=lambda v: v["race_date"])
def test_edition_freeze_and_history_follow_schedule_vectors(
        conn: Connection, vec: dict[str, Any]) -> None:
    """월말·연말·윤일 포함 벡터 — 동결은 정확히 D-1 18:00 KST, H 는 정확히 D-1."""
    d = date.fromisoformat(vec["race_date"])
    h = date.fromisoformat(vec["history_before"])
    freeze = datetime.fromisoformat(vec["freeze_at"])
    rv = add_rule_set(conn)
    add_edition(conn, rules_version=rv, race_date=d, history_before=h, freeze_at=freeze,
                published_at=freeze)
    # 1분 어긋남 · UTC 18:00(= KST 03:00) 거부. 발행 시각은 각자 +5분이라 창 조건은 만족
    for bad in (freeze - timedelta(minutes=1), freeze + timedelta(minutes=1),
                freeze.replace(tzinfo=UTC)):
        assert_check(conn, "ck_rf_window", partial(
            add_edition, conn, rules_version=rv, race_date=d, history_before=h, freeze_at=bad,
            published_at=bad + timedelta(minutes=5)))
    for bad_h in (h - timedelta(days=1), h + timedelta(days=1)):
        assert_check(conn, "ck_rf_history", partial(
            add_edition, conn, rules_version=rv, race_date=d, history_before=bad_h,
            results_through=None))


@pytest.mark.parametrize("vec", VECTORS["windows"],
                         ids=lambda v: f"{v['now']}|fp={v['first_post']}")
def test_edition_publish_window_matches_schedule_vectors(
        conn: Connection, vec: dict[str, Any]) -> None:
    """schedule.in_window 이 참인 시각에만 DB 가 발행본을 받는다.

    창 경계가 분 단위라 schedule 의 분 절사 판정과 DB 의 정확한 시각 비교가 같은 답을 낸다.
    """
    d = date.fromisoformat(vec["race_date"])
    action = partial(add_edition, conn, race_date=d, freeze_at=schedule.freeze_at(d, R1),
                     deadline_at=schedule.deadline_at(d, vec["first_post"], R1),
                     published_at=datetime.fromisoformat(vec["now"]))
    if vec["in_window"]:
        action()
    else:
        assert_check(conn, "ck_rf_window", action)


@pytest.mark.parametrize("vec", VECTORS["deadlines"],
                         ids=lambda v: f"{v['race_date']}|fp={v['first_post']}")
def test_edition_accepts_schedule_deadlines(conn: Connection, vec: dict[str, Any]) -> None:
    add_edition(conn, race_date=date.fromisoformat(vec["race_date"]),
                deadline_at=datetime.fromisoformat(vec["deadline_at"]))


def test_edition_publish_window_is_half_open(conn: Connection) -> None:
    rv = add_rule_set(conn)
    freeze, deadline = at(D - timedelta(days=1), 18), at(D, 8)
    add_edition(conn, rules_version=rv, published_at=freeze)  # 하한 포함
    add_edition(conn, rules_version=rv, published_at=deadline - US)  # 마감 직전
    assert_check(conn, "ck_rf_window",
                 partial(add_edition, conn, rules_version=rv, published_at=freeze - US))
    assert_check(conn, "ck_rf_window",  # 상한 제외
                 partial(add_edition, conn, rules_version=rv, published_at=deadline))
    # 첫 발주 08:30 → 마감 07:30
    early = at(D, 7, 30)
    add_edition(conn, rules_version=rv, deadline_at=early, published_at=early - US)
    assert_check(conn, "ck_rf_window", partial(
        add_edition, conn, rules_version=rv, deadline_at=early, published_at=early))


def test_edition_deadline_bounds(conn: Connection) -> None:
    rv = add_rule_set(conn)
    freeze = at(D - timedelta(days=1), 18)
    add_edition(conn, rules_version=rv, deadline_at=at(D, 8))
    for bad in (at(D, 8) + US, at(D, 9)):  # D 08:00 을 넘는 마감
        assert_check(conn, "ck_rf_window",
                     partial(add_edition, conn, rules_version=rv, deadline_at=bad))
    # 마감은 동결보다 뒤
    assert_check(conn, "ck_rf_window", partial(
        add_edition, conn, rules_version=rv, deadline_at=freeze, published_at=freeze))


@pytest.mark.parametrize("tz", ["UTC", "Asia/Seoul", "America/Los_Angeles"])
def test_edition_window_is_absolute_kst(conn: Connection, tz: str) -> None:
    """D-1 18:00 은 세션 TimeZone 과 무관한 KST 절대 시각.

    tz 없는(naive) 시각은 세션 TimeZone 으로 해석되므로 KST 세션에서만 통과한다
    (UTC 세션의 18:00 = KST 03:00) — 잡은 항상 tz-aware 시각을 넘겨야 한다.
    """
    conn.execute(text("SELECT set_config('TimeZone', :tz, true)"), {"tz": tz})
    rv = add_rule_set(conn)
    add_edition(conn, rules_version=rv)
    freeze = at(D - timedelta(days=1), 18)
    utc18 = freeze.replace(tzinfo=UTC)
    assert_check(conn, "ck_rf_window", partial(
        add_edition, conn, rules_version=rv, freeze_at=utc18,
        published_at=utc18 + timedelta(minutes=5)))
    naive = freeze.replace(tzinfo=None)
    action = partial(add_edition, conn, rules_version=rv, freeze_at=naive,
                     published_at=naive + timedelta(minutes=5))
    if tz == "Asia/Seoul":
        action()
    else:
        assert_check(conn, "ck_rf_window", action)


def test_edition_results_through_before_history(conn: Connection) -> None:
    rv = add_rule_set(conn)
    h = D - timedelta(days=1)
    add_edition(conn, rules_version=rv, results_through=None)
    add_edition(conn, rules_version=rv, results_through=h - timedelta(days=1))
    for bad in (h, h + timedelta(days=1)):
        assert_check(conn, "ck_rf_results_through",
                     partial(add_edition, conn, rules_version=rv, results_through=bad))


def test_edition_summary_must_mirror_payload(conn: Connection) -> None:
    rv = add_rule_set(conn)
    meet = new_meet()
    payload = make_payload(D, meet, rv)
    # summary 를 따로 넘겨도 payload.summary 와 같은 jsonb 면 통과 (키 순서·공백 무관)
    add_edition(conn, rules_version=rv, meet=meet, payload=payload,
                summary=json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    no_summary = {k: v for k, v in payload.items() if k != "summary"}
    assert_check(conn, "ck_rf_summary", partial(
        add_edition, conn, rules_version=rv, payload=no_summary, summary=payload["summary"]))
    assert_check(conn, "ck_rf_summary", partial(
        add_edition, conn, rules_version=rv, payload=payload,
        summary={**payload["summary"], "race_count": 2}))
    # 객체가 아닌 payload — ? 는 배열 원소·문자열 스칼라에도 참이라 따로 막는다
    for not_object in (["summary"], '"summary"'):
        assert_check(conn, "ck_rf_summary", partial(
            add_edition, conn, rules_version=rv, payload=not_object, summary={}))


def test_edition_payload_sha256_is_sql_hash_of_jsonb_text(conn: Connection) -> None:
    rv = add_rule_set(conn)
    meet = new_meet()
    serialized = dumps(make_payload(D, meet, rv))
    ed = add_edition(conn, rules_version=rv, meet=meet, payload=serialized)
    stored_text, stored_sha = conn.execute(text(
        "SELECT payload::text, payload_sha256 FROM racing_form_editions WHERE id = :i"),
        {"i": ed.id}).one()
    # 정의: sha256(jsonb 정규 텍스트의 UTF-8) — verify 가 이 식으로 다시 계산한다
    assert stored_sha == hashlib.sha256(stored_text.encode("utf-8")).hexdigest()
    # Python 직렬화(공백 없음·키 사전순) 해시와 다르다 → SQL 밖에서 계산해 넣으면 거부
    py_sha = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    assert py_sha != stored_sha
    for bad in (py_sha, "0" * 64, stored_sha.upper()):
        assert_check(conn, "ck_rf_sha", partial(
            add_edition, conn, rules_version=rv, payload=serialized, payload_sha256=bad))


def test_edition_unique_day_meet_and_issue_no(conn: Connection) -> None:
    rv = add_rule_set(conn)
    meet = new_meet()
    add_edition(conn, rules_version=rv, meet=meet, issue_no=1)
    # 같은 (경주일, 경마장) 두 번째 호 — 철회 후 재발행도 불가
    assert_unique(conn, "uq_rf_editions_day_meet",
                  partial(add_edition, conn, rules_version=rv, meet=meet, issue_no=2))
    # 경마장별 호수 중복
    nxt = D + timedelta(days=7)
    assert_unique(conn, "uq_rf_editions_issue", partial(
        add_edition, conn, rules_version=rv, race_date=nxt, meet=meet, issue_no=1))
    add_edition(conn, rules_version=rv, race_date=nxt, meet=meet, issue_no=2)
    # 호수는 경마장별 — 다른 경마장은 같은 날 1호 가능
    add_edition(conn, rules_version=rv, meet=new_meet(), issue_no=1)


def test_edition_misc_checks(conn: Connection) -> None:
    rv = add_rule_set(conn)
    for constraint, over in (
        ("ck_rf_issue_no", {"issue_no": 0}),
        ("ck_rf_schema_version", {"schema_version": 0}),
        ("ck_rf_counts", {"race_count": -1}),
        ("ck_rf_counts", {"runner_count": -1}),
    ):
        assert_check(conn, constraint, partial(add_edition, conn, rules_version=rv, **over))
    err = rejected(conn, partial(add_edition, conn, rules_version=f"없는버전-{_uid()}"))
    assert err.sqlstate == "23503", _desc(err)


def test_rule_set_sha_format(conn: Connection) -> None:
    for bad in ("x" * 64, "A" * 64, "a" * 63, ""):
        assert_check(conn, "ck_rf_rule_sets_sha",
                     partial(add_rule_set, conn, definition_sha256=bad))


# ============================================================== 예상 (picks) CHECK


def test_pick_rule_key_whitelist(conn: Connection) -> None:
    ed = add_edition(conn)
    for key in definitions.RULE_KEYS:
        add_pick(conn, ed, rule_key=key)
    add_pick(conn, ed, rule_key=definitions.CONSENSUS_KEY, votes=3)
    for bad in ("popularity", "Rating", "consensus2"):
        assert_check(conn, "ck_rf_picks_rule_key", partial(add_pick, conn, ed, rule_key=bad))


def test_pick_mark_and_race_no_ranges(conn: Connection) -> None:
    ed = add_edition(conn)
    for mark, horse in ((1, "0041001"), (2, "0041002"), (3, "0041003")):  # ◎○△
        add_pick(conn, ed, mark=mark, horse_no=horse)
    for bad in (0, 4, -1):
        assert_check(conn, "ck_rf_picks_mark",
                     partial(add_pick, conn, ed, rule_key="form", mark=bad))
    add_pick(conn, ed, race_no=30)
    for bad in (0, 31):
        assert_check(conn, "ck_rf_picks_race_no", partial(add_pick, conn, ed, race_no=bad))


def test_pick_consensus_votes_rules(conn: Connection) -> None:
    ed = add_edition(conn)
    add_pick(conn, ed, rule_key="consensus", mark=1, horse_no="0041001", votes=4)
    add_pick(conn, ed, rule_key="consensus", mark=2, horse_no="0041002", votes=3)
    # 주목마는 votes 필수
    assert_check(conn, "ck_rf_picks_consensus",
                 partial(add_pick, conn, ed, race_no=2, rule_key="consensus", votes=None))
    # 주목마는 경주당 최대 2두 (mark 1·2)
    assert_check(conn, "ck_rf_picks_consensus", partial(
        add_pick, conn, ed, rule_key="consensus", mark=3, horse_no="0041003", votes=3))
    # 기준별 예상에는 votes 없음
    assert_check(conn, "ck_rf_picks_consensus",
                 partial(add_pick, conn, ed, race_no=2, rule_key="rating", votes=3))


def test_pick_unique_mark_and_horse_per_rule(conn: Connection) -> None:
    ed = add_edition(conn)
    add_pick(conn, ed, mark=1, horse_no="0041001")
    # 같은 경주·기준에서 같은 기호를 두 말에
    assert_unique(conn, "uq_rf_picks_mark",
                  partial(add_pick, conn, ed, mark=1, horse_no="0041002"))
    # 같은 경주·기준에서 한 말에 기호 두 개
    assert_unique(conn, "uq_rf_picks_horse",
                  partial(add_pick, conn, ed, mark=2, horse_no="0041001"))
    # 다른 기준 · 다른 경주 · 주목마 · 다른 호는 같은 말에 같은 기호 가능
    add_pick(conn, ed, rule_key="form", mark=1, horse_no="0041001")
    add_pick(conn, ed, race_no=2, mark=1, horse_no="0041001")
    add_pick(conn, ed, rule_key="consensus", mark=1, horse_no="0041001", votes=3)
    add_pick(conn, add_edition(conn, rules_version=ed.rules_version), mark=1,
             horse_no="0041001")


# ============================================================== 공지 (notices) CHECK


def test_notice_edition_requirement_by_kind(conn: Connection) -> None:
    ed = add_edition(conn)
    add_notice(conn, kind="missed")
    assert_check(conn, "ck_rf_notice_edition",
                 partial(add_notice, conn, kind="missed", edition_id=ed.id))
    for kind in ("erratum", "withdrawn", "result_changed"):
        add_notice(conn, kind=kind, edition_id=ed.id, source="operator")
        assert_check(conn, "ck_rf_notice_edition", partial(add_notice, conn, kind=kind))
    add_notice(conn, kind="publish_failed")
    add_notice(conn, kind="paused", meet=None, source="operator")  # meet NULL = 전체


@pytest.mark.parametrize("detail", [
    {}, {"until": None}, {"until": ""}, {"until": "2026/11/30"}, {"until": "20261130"},
    {"until": 20261130}, {"until": "2026-11-30T00:00"}, {"until": "2026-1-30"}, ["until"],
], ids=["missing", "json-null", "empty", "slash", "compact", "number", "datetime", "short",
        "array"])
def test_notice_paused_rejects_bad_until(conn: Connection, detail: Any) -> None:
    assert_check(conn, "ck_rf_notice_paused", partial(add_notice, conn, kind="paused",
                                                      source="operator", detail=detail))


def test_notice_paused_until_ok_and_only_required_for_paused(conn: Connection) -> None:
    add_notice(conn, kind="paused", source="operator", detail={"until": "2026-11-30"})
    add_notice(conn, kind="paused", source="operator",
               detail={"until": "2026-12-31", "reason": "연말 휴장"})
    add_notice(conn, kind="missed", detail={})


def test_notice_kind_source_whitelist_and_dedup(conn: Connection) -> None:
    # 목록 밖 kind 는 ck_rf_notice_kind 와 ck_rf_notice_edition 이 함께 거부한다
    # (PG 는 CHECK 를 이름순으로 검사해 먼저 걸린 것을 보고)
    assert_check(conn, ("ck_rf_notice_kind", "ck_rf_notice_edition"),
                 partial(add_notice, conn, kind="other"))
    assert_check(conn, "ck_rf_notice_source", partial(add_notice, conn, source="cron"))
    key = f"missed|{D.isoformat()}|시험|{_uid()}"
    add_notice(conn, dedup_key=key)
    assert_unique(conn, "uq_rf_notices_dedup", partial(add_notice, conn, dedup_key=key))


# ============================================================== 과거 시험 (backtests) CHECK


def test_backtest_report_sha256_is_sql_hash(conn: Connection) -> None:
    report = {"rules": {"rating": {"n": 120, "wins": 31}}, "메모": "과거 시험"}
    add_backtest(conn, report=report)  # SQL 이 같은 CAST(:report AS jsonb) 로 계산
    py_sha = hashlib.sha256(dumps(report).encode("utf-8")).hexdigest()
    for bad in ("0" * 64, py_sha):
        assert_check(conn, "ck_rf_bt_sha",
                     partial(add_backtest, conn, report=report, report_sha256=bad))


def test_backtest_holdout_once_per_definition(conn: Connection) -> None:
    sha_a, sha_b = _sha(), _sha()
    add_backtest(conn, definition_sha256=sha_a, label="holdout")
    assert_unique(conn, "uq_rf_backtests_holdout",
                  partial(add_backtest, conn, definition_sha256=sha_a, label="holdout"))
    # dev 는 몇 번이든, 다른 정의의 holdout 은 따로 1회
    add_backtest(conn, definition_sha256=sha_a, label="dev")
    add_backtest(conn, definition_sha256=sha_a, label="dev")
    add_backtest(conn, definition_sha256=sha_b, label="holdout")


def test_backtest_misc_checks(conn: Connection) -> None:
    assert_check(conn, "ck_rf_bt_label", partial(add_backtest, conn, label="prod"))
    assert_check(conn, "ck_rf_bt_period", partial(
        add_backtest, conn, period_from=date(2026, 6, 1), period_to=date(2026, 5, 31)))
    for bad in ("abc", "A" * 64, "g" * 64):
        assert_check(conn, "ck_rf_bt_def_sha",
                     partial(add_backtest, conn, definition_sha256=bad))
