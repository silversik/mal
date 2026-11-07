"""sync_yesterday_catchup — 매출 실패가 결과 0건 invariant 검사를 가리지 않는지."""
from __future__ import annotations

import importlib
import sys
import types
from contextlib import contextmanager
from typing import Any

import pytest


@pytest.fixture
def periodic(monkeypatch: pytest.MonkeyPatch) -> Any:
    # crawler_core(sibling 레포) 는 테스트 환경에 없을 수 있어 가짜 모듈로 대체.
    client = types.SimpleNamespace(
        safe_register=lambda **kw: None,
        safe_start_run=lambda job_key: None,
        safe_finish_run=lambda run_id, **kw: None,
    )
    pkg = types.ModuleType("crawler_core")
    pkg.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crawler_core", pkg)
    monkeypatch.setitem(sys.modules, "crawler_core.client", client)  # type: ignore[arg-type]
    monkeypatch.delitem(sys.modules, "src.monitoring", raising=False)
    monkeypatch.delitem(sys.modules, "src.jobs.periodic", raising=False)
    return importlib.import_module("src.jobs.periodic")


@pytest.fixture
def env(periodic: Any, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """결과·배당·매출 sync + invariant SQL(entries/results 카운트) mock."""
    state: dict[str, Any] = {"entries": 0, "results": 0, "sales": 5, "sql": 0}

    @contextmanager
    def fake_session():
        class _Result:
            def one(self) -> Any:
                return types.SimpleNamespace(entries=state["entries"], results=state["results"])

        class _Session:
            def execute(self, *_a: Any, **_k: Any) -> _Result:
                state["sql"] += 1
                return _Result()

        yield _Session()

    import src.db

    monkeypatch.setattr(src.db, "session_scope", fake_session)
    monkeypatch.setattr(periodic, "sync_date_all_meets", lambda d: 10)
    monkeypatch.setattr(periodic, "sync_dividends_all_meets", lambda d: 20)

    def sales(d: Any) -> int:
        v = state["sales"]
        if isinstance(v, BaseException):
            raise v
        return v

    monkeypatch.setattr(periodic, "sync_race_sales_all_meets", sales)
    state["run"] = periodic.run_sync_yesterday_catchup
    return state


def test_ok_returns_total(env: dict[str, Any]) -> None:
    env["entries"], env["results"] = 12, 12
    assert env["run"]() == 35
    assert env["sql"] == 1


def test_invariant_fails_without_sales_error(env: dict[str, Any]) -> None:
    env["entries"], env["results"] = 12, 0
    with pytest.raises(RuntimeError, match="yesterday_catchup_incomplete") as ei:
        env["run"]()
    assert "race_sales" not in str(ei.value)


def test_sales_error_still_runs_invariant_and_reraises(env: dict[str, Any]) -> None:
    boom = RuntimeError("sync_race_sales: 시도한 3개 단위 전부 실패")
    env["sales"] = boom
    env["entries"], env["results"] = 12, 12
    with pytest.raises(RuntimeError) as ei:
        env["run"]()
    assert ei.value is boom  # invariant 정상이면 원래 예외 그대로
    assert env["sql"] == 1  # 매출이 실패해도 invariant 검사는 돌았다


def test_sales_error_and_invariant_combined(env: dict[str, Any]) -> None:
    env["sales"] = ValueError("sales boom")
    env["entries"], env["results"] = 12, 0
    with pytest.raises(RuntimeError) as ei:
        env["run"]()
    msg = str(ei.value)
    assert "yesterday_catchup_incomplete" in msg
    assert "sales boom" in msg and "ValueError" in msg
    assert isinstance(ei.value.__cause__, ValueError)


def test_races_step_error_still_runs_other_steps_and_invariant(
    env: dict[str, Any], periodic: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    def races_boom(d: Any) -> int:
        raise RuntimeError("race_results: 전부 실패")

    def divs(d: Any) -> int:
        calls.append("div")
        return 3

    monkeypatch.setattr(periodic, "sync_date_all_meets", races_boom)
    monkeypatch.setattr(periodic, "sync_dividends_all_meets", divs)
    env["entries"], env["results"] = 12, 0
    with pytest.raises(RuntimeError) as ei:
        env["run"]()
    msg = str(ei.value)
    assert "yesterday_catchup_incomplete" in msg and "races 실패" in msg
    assert calls == ["div"] and env["sql"] == 1


def test_invariant_query_error_keeps_step_error(
    env: dict[str, Any], periodic: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    env["sales"] = ValueError("sales boom")

    def broken(_d: Any) -> None:
        raise ConnectionError("db down")

    monkeypatch.setattr(periodic, "_yesterday_results_invariant", broken)
    with pytest.raises(RuntimeError) as ei:
        env["run"]()
    msg = str(ei.value)
    assert "sales boom" in msg and "db down" in msg


def test_uses_kst_yesterday(
    env: dict[str, Any], periodic: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    import datetime as dt

    seen: list[Any] = []
    monkeypatch.setattr(periodic, "sync_date_all_meets", lambda d: seen.append(d) or 0)

    class _Fake(dt.datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: ANN001, ANN206
            # UTC 11/6 22:30 = KST 11/7 07:30 → 어제(KST) = 11/6
            base = dt.datetime(2026, 11, 6, 22, 30, tzinfo=dt.UTC)
            return base.astimezone(tz) if tz else base.replace(tzinfo=None)

    monkeypatch.setattr(periodic, "datetime", _Fake)
    env["run"]()
    assert seen == [dt.date(2026, 11, 6)]


def test_no_entries_with_sales_error_reraises_sales(env: dict[str, Any]) -> None:
    env["sales"] = KeyError("x")
    with pytest.raises(KeyError):
        env["run"]()
    assert env["sql"] == 1


# ------------------------------------------------- residual (09~12시)


@pytest.fixture
def residual(periodic: Any, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    calls: list[str] = []
    state: dict[str, Any] = {"calls": calls, "unresolved": True}
    monkeypatch.setattr(periodic, "_has_unresolved_races_on", lambda d: state["unresolved"])
    for name, attr, n in (
        ("races", "sync_date_all_meets", 2),
        ("dividends", "sync_dividends_all_meets", 3),
        ("sales", "sync_race_sales_all_meets", 7),
    ):
        def step(d: Any, _name: str = name, _n: int = n) -> int:
            calls.append(_name)
            err = state.get(f"{_name}_err")
            if err:
                raise err
            return _n

        monkeypatch.setattr(periodic, attr, step)
    state["run"] = periodic.run_sync_yesterday_residual.__wrapped__
    return state


def test_residual_fetches_sales_too(residual: dict[str, Any]) -> None:
    """07:30 이후 공표된 경주도 매출을 받는다 (E2E 가 찾은 누락)."""
    assert residual["run"]() == 12
    assert residual["calls"] == ["races", "dividends", "sales"]


def test_residual_skips_when_resolved(residual: dict[str, Any]) -> None:
    residual["unresolved"] = False
    assert residual["run"]() == 0
    assert residual["calls"] == []


def test_residual_single_failure_reraised_as_is(residual: dict[str, Any]) -> None:
    boom = RuntimeError("sync_race_sales: 시도한 3개 단위 전부 실패")
    residual["sales_err"] = boom
    with pytest.raises(RuntimeError) as ei:
        residual["run"]()
    assert ei.value is boom
    assert residual["calls"] == ["races", "dividends", "sales"]


def test_residual_multiple_failures_are_combined(residual: dict[str, Any]) -> None:
    residual["races_err"] = RuntimeError("races down")
    residual["sales_err"] = RuntimeError("sales down")
    with pytest.raises(RuntimeError, match="races 실패.*추가로 sales 실패"):
        residual["run"]()
    assert residual["calls"] == ["races", "dividends", "sales"]


def test_residual_uses_kst_yesterday(
    residual: dict[str, Any], periodic: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """UTC 11/5 15:30 = KST 11/6 00:30 → 어제는 11/5 (UTC 기준이면 11/4)."""
    from datetime import UTC, date, datetime

    class _Fake(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            t = datetime(2026, 11, 5, 15, 30, tzinfo=UTC)
            return t.astimezone(tz) if tz else t.replace(tzinfo=None)

    monkeypatch.setattr(periodic, "datetime", _Fake)
    seen: list[Any] = []
    monkeypatch.setattr(
        periodic, "_has_unresolved_races_on", lambda d: seen.append(d) or False
    )
    residual["run"]()
    assert seen == [date(2026, 11, 5)]
