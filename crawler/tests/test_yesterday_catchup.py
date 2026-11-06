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


def test_no_entries_with_sales_error_reraises_sales(env: dict[str, Any]) -> None:
    env["sales"] = KeyError("x")
    with pytest.raises(KeyError):
        env["run"]()
    assert env["sql"] == 1
