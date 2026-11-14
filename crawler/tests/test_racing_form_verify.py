"""경마지 무결성 점검(verify) — 판정 규칙·실패 격리 (DB 없음, SQL 상수별 가짜 결과).

실제 DB 경로(해시 재계산·트리거 12개·picks = payload)는 test_racing_form_cli.py 가 시드 DB 로 본다.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from typing import Any

from racing_form_fakes import kst

from src.racing_form import definitions, verify

PUB = kst(2026, 11, 13, 18, 5)


def editions_ok() -> list[dict[str, Any]]:
    return [{"id": 1, "race_date": "2026-11-14", "meet": "서울", "rules_version": "r1",
             "published_at": PUB, "created_at": PUB + timedelta(seconds=2),
             "sha_ok": True, "summary_ok": True}]


def triggers_ok() -> list[dict[str, Any]]:
    return [{"name": n, "schema_name": "mal", "table_name": t, "enabled": "A"}
            for n, t in sorted(verify.EXPECTED_TRIGGERS.items())]


def rule_sets_ok() -> list[dict[str, Any]]:
    r1 = definitions.get("r1")
    return [{"rules_version": "r1", "definition_sha256": definitions.definition_sha256(r1),
             "definition": json.loads(definitions.definition_json(r1))}]


def picks_ok() -> list[dict[str, Any]]:
    return [{"edition_id": 1, "race_date": "2026-11-14", "meet": "서울", "expected": 40,
             "actual": 40, "missing": 0, "extra": 0}]


def data_ok() -> dict[Any, Any]:
    return {
        verify._EDITIONS: editions_ok(),
        verify._LIVE_SCHEMA: [{"schema_name": "mal"}],
        verify._TRIGGERS: triggers_ok(),
        verify._RULE_SETS: rule_sets_ok(),
        verify._PICKS: picks_ok(),
        verify._PICKS_META: [],
    }


class _Result:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> _Result:
        return self

    def all(self) -> list[dict[str, Any]]:
        return self._rows


def fake_factory(data: dict[Any, Any], log: list[str]) -> Any:
    """read_only_provider 가 여는 트랜잭션 자리 — SQL 상수(TextClause)별로 정한 행을 준다."""

    class Conn:
        def execute(self, clause: Any, params: Any = None) -> _Result:
            if clause in data:
                v = data[clause]
                if isinstance(v, Exception):
                    raise v
                return _Result(copy.deepcopy(v))
            log.append(" ".join(str(clause).split())[:30])
            return _Result([])

    @contextmanager
    def tx() -> Iterator[Conn]:
        log.append("tx")
        yield Conn()

    return tx


def run(data: dict[Any, Any], **kw: Any) -> verify.VerifyReport:
    return verify.run_verify(fake_factory(data, []), **kw)


def test_all_good_has_no_problems_and_counts() -> None:
    log: list[str] = []
    rep = verify.run_verify(fake_factory(data_ok(), log))
    assert rep.ok and rep.problems == []
    assert (rep.editions, rep.triggers, rep.rule_sets, rep.picks) == (1, 12, 1, 40)
    assert verify.render_text(rep).endswith("문제 없음")
    # 점검마다 READ ONLY 트랜잭션 (SET TRANSACTION READ ONLY 가 첫 문장)
    assert log.count("tx") == 5
    assert log.count("SET TRANSACTION READ ONLY") == 5


def test_hash_summary_and_clock_problems() -> None:
    data = data_ok()
    data[verify._EDITIONS] = [
        {**editions_ok()[0], "sha_ok": False},
        {**editions_ok()[0], "id": 2, "summary_ok": False},
        {**editions_ok()[0], "id": 3, "created_at": PUB + timedelta(minutes=6)},
        {**editions_ok()[0], "id": 4, "created_at": PUB - timedelta(minutes=4)},  # 허용 안
    ]
    rep = run(data)
    assert [(p.check, p.edition_id) for p in rep.problems] == [
        ("payload", 1), ("payload", 2), ("clock", 3)]
    assert "6분" in str(rep.problems[2]) and "2026-11-13 18:05:00 KST" in str(rep.problems[2])
    assert run(data, max_clock_skew=timedelta(minutes=10)).problems[-1].check == "payload"


def test_trigger_problems() -> None:
    rows = triggers_ok()
    rows = [r for r in rows if r["name"] != "trg_rf_picks_guard"]
    rows[0] = {**rows[0], "enabled": "O"}
    rows.append({"name": "trg_rf_extra", "schema_name": "mal", "table_name": "racing_form_picks",
                 "enabled": "A"})
    rows.append({"name": "trg_rf_notices_guard", "schema_name": "mal",
                 "table_name": "racing_form_editions", "enabled": "A"})
    data = data_ok()
    data[verify._TRIGGERS] = rows
    details = [p.detail for p in run(data).problems]
    assert any("13개 (기대 12개, 스키마 mal)" in d for d in details)
    assert any("없는 트리거: trg_rf_picks_guard" in d for d in details)
    assert any("모르는 트리거: trg_rf_extra" in d for d in details)
    assert any("ENABLE ALWAYS('A') 가 아님" in d for d in details)
    assert any("mal.racing_form_editions 에 붙어 있음 (기대 mal.racing_form_notices)" in d
               for d in details)


def test_trigger_check_is_scoped_to_search_path_schema() -> None:
    """다른 스키마의 사본(복구 때 남긴 mal_broken_* 등)을 세지 않는다 — search_path 가 036 표를
    찾는 스키마만. 표가 안 풀리면 0행 → 12개 모두 없는 트리거."""
    sql = " ".join(str(verify._TRIGGERS).split())
    assert "c.relnamespace = (SELECT relnamespace FROM pg_class" in sql
    assert "to_regclass('racing_form_editions')" in sql
    assert "to_regclass('racing_form_editions')" in str(verify._LIVE_SCHEMA)
    # 살아 있는 스키마의 트리거가 모두 사라짐 (다른 스키마의 사본은 세지 않으므로 0개)
    data = data_ok()
    data[verify._TRIGGERS] = []
    details = [p.detail for p in run(data).problems]
    assert details[0] == "trg_rf_ 트리거 0개 (기대 12개, 스키마 mal)"
    assert details[1].startswith("없는 트리거: ") and details[1].count("trg_rf_") == 12
    # 036 표가 search_path 에서 안 풀림
    data[verify._LIVE_SCHEMA] = []
    details = [p.detail for p in run(data).problems if p.check == "triggers"]
    assert details[0] == (
        "trg_rf_ 트리거 0개 (기대 12개, search_path 에서 racing_form_editions 를 찾지 못함)")


def test_rule_set_problems() -> None:
    good = rule_sets_ok()[0]
    data = data_ok()
    data[verify._RULE_SETS] = [
        {**good, "rules_version": "r0"},
        {**good, "definition_sha256": "0" * 64},
        {**good, "rules_version": "r1-e2e"},  # 해시·정의가 r1 것 — 둘 다 문제
    ]
    details = [p.detail for p in run(data).problems if p.check == "rule_sets"]
    assert details[0] == "r0: 코드 레지스트리(RULE_SETS)에 없는 버전"
    assert details[1].startswith("r1: DB 정의 해시 000000000000")
    assert len([d for d in details if d.startswith("r1-e2e")]) == 2


def test_picks_problems() -> None:
    data = data_ok()
    data[verify._PICKS] = [{**picks_ok()[0], "actual": 39, "missing": 1}]
    data[verify._PICKS_META] = [{"edition_id": 1, "n": 2}]
    probs = run(data).problems
    assert [(p.check, p.edition_id) for p in probs] == [("picks", 1), ("picks", 1)]
    assert "예상 행 39 (payload 기준 40) · 빠짐 1 · 남음 0" in probs[0].detail


def test_failed_check_is_a_problem_and_others_continue() -> None:
    data = data_ok()
    data[verify._TRIGGERS] = RuntimeError('relation "pg_trigger" password=hunter2 boom')
    rep = run(data)
    assert [p.check for p in rep.problems] == ["triggers"]
    assert rep.problems[0].detail.startswith("점검 실패 — RuntimeError")
    assert rep.rule_sets == 1 and rep.picks == 40  # 나머지 점검은 계속
    assert not rep.ok and "문제 1건" in verify.render_text(rep)


def test_verify_returns_problem_list() -> None:
    assert verify.verify(fake_factory(data_ok(), [])) == []
    assert len(verify.EXPECTED_TRIGGERS) == 12
