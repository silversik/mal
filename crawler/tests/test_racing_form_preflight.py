"""경마지 출시 전 감사(preflight) — 쿼리 안전성·트랜잭션 순서·항목 판정·실패 격리 (DB 없음)."""

from __future__ import annotations

import json
import re
import types
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from racing_form_fakes import kst

from src.racing_form import definitions, preflight
from src.racing_form.preflight import FAIL, INFO, OK, WARN

NOW = kst(2026, 11, 14, 13, 0)
TODAY = NOW.date()
R1 = definitions.get("r1")

_WRITE_RE = re.compile(
    r"\b(insert|update|delete|merge|upsert|alter|drop|create|truncate|grant|revoke|copy|vacuum|"
    r"lock|call|do|analyze)\b",
    re.IGNORECASE,
)


def test_queries_are_read_only_statements() -> None:
    assert len({spec.no for spec in preflight.SPECS}) == 18
    for name, sql in preflight.QUERIES.items():
        stripped = re.sub(r"\b\w+_\w+\b", "", sql)  # updated_at 같은 식별자 제외
        assert not _WRITE_RE.search(stripped), name
        assert sql.lstrip().upper().startswith(("SELECT", "WITH", "EXPLAIN (FORMAT JSON)")), name
        assert "now()" not in sql.lower() and "current_date" not in sql.lower(), name


class _Log:
    def __init__(self) -> None:
        self.calls: list[str] = []


class _FakeConn:
    def __init__(self, log: _Log) -> None:
        self.log = log

    def __enter__(self) -> _FakeConn:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.log.calls.append("close")

    def begin(self) -> Any:
        self.log.calls.append("begin")
        return types.SimpleNamespace(rollback=lambda: self.log.calls.append("rollback"),
                                     commit=lambda: self.log.calls.append("commit"))

    def execute(self, clause: Any, params: Any = None) -> Any:
        self.log.calls.append(" ".join(str(clause).split())[:40])
        return [types.SimpleNamespace(_mapping={"num": 160015, "version": "PostgreSQL 16"})]


def test_sql_rows_runs_read_only_with_timeouts_and_rolls_back() -> None:
    log = _Log()
    db = preflight.SqlRows(types.SimpleNamespace(connect=lambda: _FakeConn(log)))
    assert db.rows("q18_version") == [{"num": 160015, "version": "PostgreSQL 16"}]
    assert log.calls[:4] == [
        "begin",
        "SET TRANSACTION READ ONLY",
        "SET LOCAL statement_timeout = 15000",
        "SET LOCAL lock_timeout = 2000",
    ]
    assert log.calls[4].startswith("SELECT current_setting")
    assert log.calls[5:] == ["rollback", "close"]
    assert "commit" not in log.calls


def _utc(d: date, hh: int, mm: int = 0) -> datetime:
    return kst(d.year, d.month, d.day, hh, mm).astimezone(UTC)


def healthy() -> dict[str, Any]:
    sat = date(2026, 11, 7)
    return {
        "q01_classes": [{"cls": "ranked", "rank_null": False, "n": 900},
                        {"cls": "unranked_timed", "rank_null": True, "n": 3},
                        {"cls": "no_rank_no_time", "rank_null": False, "n": 2}],
        "q01_samples": [{"ord": "0", "st_ord": None, "rc_time": "-", "differ": "주행중지",
                         "has_time": False, "n": 2, "last_date": sat}],
        "q02_stale": [{"stale": True, "started": False, "n": 4},
                      {"stale": False, "started": True, "n": 96}],
        "q03_rating_pairs": [{"meet": "서울", "entry_rating": 65, "entry_raw": "65",
                              "result_raw": "65", "n": 99},
                             {"meet": "서울", "entry_rating": 0, "entry_raw": "66",
                              "result_raw": "66", "n": 1}],
        "q04_jk_years": [{"year": 2026, "meet": "서울", "n": 100, "with_jk_no": 99}],
        "q04_homonyms": [{"meet": "서울", "name": "김동명", "ids": 2, "rides": 50,
                          "last_date": sat}],
        "q05_values": [{"key": "rcTime", "v": "1:12.8", "n": 90},
                       {"key": "rcTime", "v": "-", "n": 2},
                       {"key": "rcDist", "v": "1200", "n": 92},
                       {"key": "wgBudam", "v": "54.0", "n": 92},
                       {"key": "hrRating", "v": "0", "n": 5},
                       {"key": "hrRating", "v": "65", "n": 87},
                       {"key": "entry_wgBudam", "v": "54.0", "n": 10},
                       {"key": "entry_hrRating", "v": "65", "n": 10}],
        "q05_time_column": [{"n": 92, "null_with_raw": 0}],
        "q06_retention": [{"meet": m, "first_date": date(2019, 1, 5), "last_date": sat,
                           "days": 800, "n": 90000} for m in ("부경", "서울", "제주")],
        "q06_years": [{"meet": "서울", "year": 2025, "days": 104}],
        "q07_consecutive": [{"pairs": 3, "horses": 3, "last_date": sat}],
        "q07_same_day": [{"n": 0}],
        "q08_start_times": [{"race_date": sat, "meet": "서울", "start_times": ["11:00", "9:50"],
                             "races": 12}],
        "q09_entries": [{"race_date": sat, "meet": "서울",
                         "first_fetched": _utc(sat - timedelta(days=3), 16),
                         "batch_at": _utc(sat - timedelta(days=1), 15), "stamps": 1, "n": 120,
                         "stale": 0}],
        "q10_first": [{"first_fetched": _utc(date(2026, 4, 1), 6, 25),
                       "first_race_date": date(2026, 4, 2), "n": 300}],
        "q10_recent": [{"race_date": sat, "meet": "서울",
                        "fetched_at": _utc(sat - timedelta(days=1), 6, 25)},
                       {"race_date": sat, "meet": "서울", "fetched_at": _utc(sat, 6, 25)}],
        "q11_coverage": [{"meet": "서울", "year": 2026, "races": 100, "with_win": 98}],
        "q11_unmatched": [{"n": 980, "unmatched": 0}],
        "q12_meets": [{"tbl": "races", "meet": "서울", "n": 10},
                      {"tbl": "race_plans", "meet": "부산경남", "n": 4}],
        "q13_rating_deltas": [{"delta": 0, "n": 50}, {"delta": 4, "n": 10}, {"delta": -12, "n": 2}],
        "q14_dead_heats": [{"rank": 1, "races": 2, "last_date": sat}],
        "q14_examples": [{"race_date": sat, "meet": "서울", "race_no": 7, "rank": 1, "horses": 2}],
        "q15_entries": [{"race_date": sat, "meet": "서울", "race_no": n, "n": 10, "rated": 9}
                        for n in range(1, 11)],
        "q15_results": [{"meet": "서울", "year": 2026, "race_date": sat, "race_no": n, "n": 10,
                         "rated": 10} for n in range(1, 11)],
        "q16_sample": [{"race_date": TODAY, "meet": "서울", "horse_no": f"H{i}",
                        "jockey_name": f"기수{i}"} for i in range(5)],
        "q16_size": [{"race_results_rows": 300_000}],
        "q16_explain_q2": [{"QUERY PLAN": [{"Plan": {
            "Node Type": "Sort", "Total Cost": 12.5, "Plan Rows": 40, "Plans": [
                {"Node Type": "Index Scan", "Relation Name": "race_results",
                 "Index Name": "idx_race_results_horse_date"}]}}]}],
        "q16_explain_q3": [{"QUERY PLAN": [{"Plan": {
            "Node Type": "Aggregate", "Total Cost": 900.0, "Plan Rows": 5, "Plans": [
                {"Node Type": "Seq Scan", "Relation Name": "race_results"}]}}]}],
        "q17_jc_dups": [{"keys": 300, "dup_keys": 2, "conflicting": 0, "max_rows": 2}],
        "q18_version": [{"num": 160015, "version": "PostgreSQL 16.15"}],
    }


class FakeRows:
    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def rows(self, name: str, **params: Any) -> list[dict[str, Any]]:
        assert name in preflight.QUERIES, name
        self.calls.append((name, params))
        v = self.data.get(name, [])
        if isinstance(v, Exception):
            raise v
        return [dict(r) for r in v]


def by_key(items: list[preflight.Item]) -> dict[str, preflight.Item]:
    return {i.key: i for i in items}


def test_healthy_run_has_no_fail_and_all_items_in_order() -> None:
    items = preflight.run_preflight(FakeRows(healthy()), NOW, R1)
    assert [i.no for i in items] == list(range(1, 19))
    assert all(i.status != FAIL for i in items), [(i.key, i.summary) for i in items]
    assert preflight.exit_code(items) == 0
    got = by_key(items)
    assert got["rating_match"].status == OK and "100/100 (100%)" in got["rating_match"].summary
    assert got["pg_version"].status == OK
    assert got["explain"].status == OK  # Q2 가 인덱스를 쓴다
    assert got["meet_values"].status == OK and "부산경남" in got["meet_values"].summary


def test_params_are_binds_not_now() -> None:
    db = FakeRows(healthy())
    preflight.run_preflight(db, NOW, R1)
    params = dict(db.calls)
    assert params["q01_classes"] == {"since": TODAY - timedelta(days=preflight.LOOKBACK_DAYS)}
    assert params["q02_stale"] == {"lo": TODAY - timedelta(days=56), "today": TODAY, "tol": 30}
    assert params["q16_sample"] == {"horizon": TODAY + timedelta(days=7)}
    q2 = params["q16_explain_q2"]
    assert q2["h"] == TODAY - timedelta(days=1) and q2["horse_nos"] == [f"H{i}" for i in range(5)]


def test_one_failing_query_fails_only_its_item() -> None:
    data = healthy()
    data["q03_rating_pairs"] = RuntimeError("canceling statement due to statement timeout")
    items = preflight.run_preflight(FakeRows(data), NOW, R1)
    got = by_key(items)
    assert got["rating_match"].status == FAIL
    assert "점검 실패" in got["rating_match"].summary and "timeout" in got["rating_match"].summary
    assert sum(1 for i in items if i.status == FAIL) == 1
    assert preflight.exit_code(items) == 1


def test_rating_match_below_gate_warns() -> None:
    data = healthy()
    data["q03_rating_pairs"] = [
        {"meet": "제주", "entry_rating": 60, "entry_raw": "60", "result_raw": "61", "n": 10},
        {"meet": "제주", "entry_rating": 60, "entry_raw": "60", "result_raw": "60", "n": 90},
    ]
    item = by_key(preflight.run_preflight(FakeRows(data), NOW, R1))["rating_match"]
    assert item.status == WARN and "90/100 (90%)" in item.summary


def test_pg_version_below_11_fails() -> None:
    data = healthy()
    data["q18_version"] = [{"num": 100023, "version": "PostgreSQL 10.23"}]
    items = preflight.run_preflight(FakeRows(data), NOW, R1)
    assert by_key(items)["pg_version"].status == FAIL and preflight.exit_code(items) == 1


def test_retention_short_warns_with_dev_advice() -> None:
    data = healthy()
    data["q06_retention"] = [
        {"meet": "서울", "first_date": date(2024, 6, 1), "last_date": date(2026, 11, 8),
         "days": 200, "n": 9},
        {"meet": "제주", "first_date": date(2026, 9, 19), "last_date": date(2026, 11, 13),
         "days": 16, "n": 9},
    ]
    item = by_key(preflight.run_preflight(FakeRows(data), NOW, R1))["retention"]
    assert item.status == WARN
    text = "\n".join(item.lines)
    assert "dev 시작을 2025-06-01 이후로 줄인다" in text
    assert "제주: 결과가 2026-09-19 부터" in text and "dev 과거 시험 불가" in text


def test_entries_arriving_after_freeze_warn() -> None:
    data = healthy()
    sat = date(2026, 11, 7)
    data["q09_entries"] = [{"race_date": sat, "meet": "제주",
                            "first_fetched": _utc(sat - timedelta(days=1), 18, 30),
                            "batch_at": _utc(sat - timedelta(days=1), 18, 30), "stamps": 2,
                            "n": 90, "stale": 3}]
    item = by_key(preflight.run_preflight(FakeRows(data), NOW, R1))["entries_arrival"]
    assert item.status == WARN
    assert "동결(D−1 18:00) 뒤 첫 도착 1개" in item.summary and "stale 행 3" in item.summary
    assert any("D−1 18:30" in line for line in item.lines)


def test_seq_scan_on_large_results_warns() -> None:
    data = healthy()
    data["q16_explain_q2"] = [{"QUERY PLAN": [{"Plan": {
        "Node Type": "Seq Scan", "Relation Name": "race_results", "Total Cost": 9e4,
        "Plan Rows": 10}}]}]
    item = by_key(preflight.run_preflight(FakeRows(data), NOW, R1))["explain"]
    assert item.status == WARN
    data["q16_size"] = [{"race_results_rows": 1000}]  # 작은 테이블은 Seq Scan 이 정상
    item = by_key(preflight.run_preflight(FakeRows(data), NOW, R1))["explain"]
    assert item.status == OK


def test_unknown_meet_values_warn_and_parse_failures() -> None:
    data = healthy()
    data["q12_meets"] = [{"tbl": "race_entries", "meet": "알수없음", "n": 3}]
    data["q05_values"] = [{"key": "rcTime", "v": "x1:2", "n": 5}, {"key": "rcTime", "v": "72.1",
                                                                   "n": 95}]
    got = by_key(preflight.run_preflight(FakeRows(data), NOW, R1))
    assert got["meet_values"].status == WARN and "'알수없음'" in got["meet_values"].summary
    pf = got["parse_failures"]
    assert pf.status == WARN and "rcTime 실패 5%" in pf.summary


def test_render_text_and_json() -> None:
    items = preflight.run_preflight(FakeRows(healthy()), NOW, R1)
    text = preflight.render_text(items, NOW)
    assert text.startswith("mal-crawler 경마지 출시 전 감사 · 2026-11-14(토) 13:00 KST")
    assert "①" in text and "⑱" in text and preflight.BACKUP_TOC_COMMAND in text
    assert text.rstrip().endswith("→ exit 0")
    body = json.loads(preflight.render_json(items, NOW))
    assert body["exit_code"] == 0 and len(body["items"]) == 18
    assert body["notes"] == [preflight.BACKUP_TOC_NOTE]
    assert {i["status"] for i in body["items"]} <= {OK, INFO, WARN, FAIL}


def test_naive_now_rejected() -> None:
    with pytest.raises(ValueError):
        preflight.run_preflight(FakeRows(healthy()), NOW.replace(tzinfo=None), R1)
