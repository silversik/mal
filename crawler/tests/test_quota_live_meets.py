"""sync_races_live 배당 meet 필터 + 경주결과 sync 의 마필 enrich limit."""
from __future__ import annotations

import importlib
import sys
import types
from contextlib import contextmanager
from datetime import UTC, date, datetime
from typing import Any

import pytest

from src.jobs import sync_race_dividends, sync_races


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


@contextmanager
def _fake_session(meets: list[str], seen: list[Any]):
    class _Result:
        def scalars(self) -> list[str]:
            return list(meets)

    class _Session:
        def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _Result:
            seen.append((str(stmt), params))
            return _Result()

    yield _Session()


class FakeDividendClient:
    calls: list[tuple[date, int]] = []

    def __enter__(self) -> FakeDividendClient:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def list_by_date(self, rc_date: date, meet: int) -> list[dict[str, Any]]:
        FakeDividendClient.calls.append((rc_date, meet))
        return []


def _fake_datetime(utc_now: datetime) -> type[datetime]:
    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return utc_now.astimezone(tz) if tz else utc_now.replace(tzinfo=None)

    return _FakeDatetime


@pytest.fixture
def live(periodic: Any, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """DB(races meet 조회) · 결과 sync · 배당 클라이언트 mock."""
    state: dict[str, Any] = {"meets": [], "sql": [], "race_dates": []}
    FakeDividendClient.calls = []
    import src.db

    monkeypatch.setattr(
        src.db, "session_scope", lambda: _fake_session(state["meets"], state["sql"])
    )
    monkeypatch.setattr(
        periodic, "sync_date_all_meets", lambda d: state["race_dates"].append(d) or 0
    )
    monkeypatch.setattr(sync_race_dividends, "RaceDividendClient", FakeDividendClient)
    # UTC 11/6 16:00 = KST 11/7 01:00 — 컨테이너 TZ 가 UTC 여도 KST 날짜로
    monkeypatch.setattr(
        periodic, "datetime", _fake_datetime(datetime(2026, 11, 6, 16, 0, tzinfo=UTC))
    )
    state["run"] = periodic.run_sync_races_live.__wrapped__  # @track_job 우회
    return state


def test_live_no_races_makes_no_kra_calls(live: dict[str, Any]) -> None:
    live["meets"] = []
    assert live["run"]() == 0
    assert FakeDividendClient.calls == []
    assert live["race_dates"] == []
    # 게이트 조회는 KST 오늘 날짜로
    assert live["sql"][0][1] == {"d": date(2026, 11, 7)}


def test_live_only_seoul_fetches_only_meet_1(live: dict[str, Any]) -> None:
    live["meets"] = ["서울"]
    live["run"]()
    assert FakeDividendClient.calls == [(date(2026, 11, 7), 1)]
    assert live["race_dates"] == [date(2026, 11, 7)]


def test_live_seoul_and_busan(live: dict[str, Any]) -> None:
    live["meets"] = ["부경", "서울"]
    live["run"]()
    assert [m for _, m in FakeDividendClient.calls] == [1, 3]


def test_live_unknown_meet_name_skips_dividends(live: dict[str, Any]) -> None:
    live["meets"] = ["알수없음"]
    live["run"]()
    assert FakeDividendClient.calls == []
    assert live["race_dates"] == [date(2026, 11, 7)]  # 결과 sync 는 그대로


def test_dividends_all_meets_default_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeDividendClient.calls = []
    monkeypatch.setattr(sync_race_dividends, "RaceDividendClient", FakeDividendClient)
    sync_race_dividends.sync_date_all_meets(date(2026, 11, 7))
    assert [m for _, m in FakeDividendClient.calls] == [1, 2, 3]


# ------------------------------------------------------------ enrich limit


@pytest.fixture
def races_env(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(sync_races, "sync_date", lambda d, meet: 1)
    monkeypatch.setattr(sync_races, "backfill_races_from_results", lambda: 0)
    monkeypatch.setattr(
        sync_races, "backfill_missing_raw", lambda **kw: calls.append(kw) or 0
    )
    return calls


def test_sync_date_all_meets_passes_backfill_limit(races_env: list[dict[str, Any]]) -> None:
    assert sync_races.sync_date_all_meets(date(2026, 11, 7)) == 3
    assert races_env == [{"limit": 50}]


def test_sync_date_all_meets_enrich_failure_does_not_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(sync_races, "sync_date", lambda d, meet: 1)
    monkeypatch.setattr(sync_races, "backfill_races_from_results", lambda: 0)

    def boom(**kw: Any) -> int:
        raise RuntimeError("backfill_missing_raw: 시도한 50건 전부 실패")

    monkeypatch.setattr(sync_races, "backfill_missing_raw", boom)
    # 결과는 이미 적재됨 — 배당 등 후속 단계가 막히지 않게 경고만
    assert sync_races.sync_date_all_meets(date(2026, 11, 7)) == 3


def test_cli_backfill_can_pass_larger_limit(
    periodic: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delitem(sys.modules, "src.main", raising=False)
    main = importlib.import_module("src.main")
    seen: list[dict[str, Any]] = []
    monkeypatch.setattr(
        main, "backfill_missing_raw", lambda **kw: seen.append(kw) or 0
    )
    main.cmd_backfill_horse_raw(limit=2000, sleep=0.0)
    assert seen == [{"limit": 2000, "sleep_sec": 0.0}]
