"""sync_horses — not-found 원장(3회 후 skip, 장애는 미집계) + 전부 실패 시 fail-loud."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import pytest

from src.clients.kra_base import KraApiError
from src.jobs import sync_horses as mod


def _http_error(status: int) -> httpx.HTTPStatusError:
    req = httpx.Request("GET", "https://apis.data.go.kr/B551015/API42_1/totalHorseInfo_1")
    return httpx.HTTPStatusError(
        f"{status}", request=req, response=httpx.Response(status, request=req)
    )


class FakeClient:
    """horse_no → 반환값(dict/None) 또는 예외. 호출 순서 기록."""

    def __init__(self, behavior: dict[str, Any]) -> None:
        self.behavior = behavior
        self.calls: list[str] = []

    def __enter__(self) -> FakeClient:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def get_by_no(self, horse_no: str) -> dict[str, Any] | None:
        self.calls.append(horse_no)
        b = self.behavior.get(horse_no)
        if isinstance(b, BaseException):
            raise b
        return b


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """DB 헬퍼 + 클라이언트 + upsert mock. 원장은 dict 로 영속 흉내."""
    state: dict[str, Any] = {
        "missing": [],
        "ledger": {},
        "saves": 0,
        "behavior": {},
        "clients": [],
        "upserted": [],
    }

    def fake_client() -> FakeClient:
        c = FakeClient(state["behavior"])
        state["clients"].append(c)
        return c

    def fake_save(attempts: dict[str, dict[str, Any]]) -> None:
        state["saves"] += 1
        state["ledger"] = {k: dict(v) for k, v in attempts.items()}

    def fake_upsert(items: list[dict[str, Any]]) -> int:
        state["upserted"].extend(it["hrNo"] for it in items)
        return len(items)

    monkeypatch.setattr(mod, "_select_missing_raw", lambda: list(state["missing"]))
    monkeypatch.setattr(
        mod, "_load_not_found_ledger",
        lambda: {k: dict(v) for k, v in state["ledger"].items()},
    )
    monkeypatch.setattr(mod, "_save_not_found_ledger", fake_save)
    monkeypatch.setattr(mod, "HorseDetailClient", fake_client)
    monkeypatch.setattr(mod, "upsert_horses", fake_upsert)
    return state


def _calls(env: dict[str, Any]) -> list[str]:
    return env["clients"][-1].calls if env["clients"] else []


def _ok(no: str) -> dict[str, Any]:
    return {"hrNo": no, "hrName": f"말{no}"}


# ------------------------------------------------------------ not-found 원장


def _set_kst_day(monkeypatch: pytest.MonkeyPatch, d: date) -> None:
    """mod.datetime.now(KST) 를 d 의 KST 정오로 고정."""
    fixed = datetime(d.year, d.month, d.day, 12, 0, tzinfo=mod.KST)

    class _Fake(datetime):
        @classmethod
        def now(cls, tz=None):  # noqa: ANN001, ANN206
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

    monkeypatch.setattr(mod, "datetime", _Fake)


def test_not_found_three_strikes_then_skipped(
    env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    env["missing"] = ["H1", "H2"]
    env["behavior"] = {"H1": None, "H2": _ok("H2")}
    day0 = date(2026, 11, 6)

    _set_kst_day(monkeypatch, day0)
    assert mod.backfill_missing_raw(sleep_sec=0) == 1
    assert env["ledger"]["H1"]["n"] == 1
    assert env["ledger"]["H1"]["reason"] == "empty"

    env["missing"] = ["H1"]  # H2 는 raw 채워짐
    for i, expected_n in ((1, 2), (2, 3)):  # 서로 다른 KST 날짜마다 1회씩만 센다
        _set_kst_day(monkeypatch, day0 + timedelta(days=i))
        assert mod.backfill_missing_raw(sleep_sec=0) == 0
        assert env["ledger"]["H1"]["n"] == expected_n

    # 다음 날: exhausted → KRA 호출 자체 없음, 0건 정상 (raise 없음)
    _set_kst_day(monkeypatch, day0 + timedelta(days=3))
    n_clients = len(env["clients"])
    assert mod.backfill_missing_raw(sleep_sec=0) == 0
    assert len(env["clients"]) == n_clients  # 클라이언트도 안 열림
    assert env["ledger"]["H1"]["n"] == 3


def test_not_found_counted_once_per_kst_day(
    env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """live 30분 틱마다 돌아도 같은 날엔 not-found 마필을 다시 조회하지 않는다."""
    env["missing"] = ["H1"]
    env["behavior"] = {"H1": None}
    _set_kst_day(monkeypatch, date(2026, 11, 6))
    mod.backfill_missing_raw(sleep_sec=0)
    calls_after_first = sum(len(c.calls) for c in env["clients"])
    for _ in range(5):
        assert mod.backfill_missing_raw(sleep_sec=0) == 0
    assert sum(len(c.calls) for c in env["clients"]) == calls_after_first
    assert env["ledger"]["H1"]["n"] == 1


def test_exhausted_retried_after_grace_days(
    env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    env["missing"] = ["H1"]
    env["ledger"] = {"H1": {"n": 3, "last": "2026-10-01", "reason": "empty"}}
    env["behavior"] = {"H1": _ok("H1")}
    _set_kst_day(monkeypatch, date(2026, 10, 1) + timedelta(days=mod.EXHAUSTED_RETRY_DAYS - 1))
    assert mod.backfill_missing_raw(sleep_sec=0) == 0  # 유예 전 → skip
    _set_kst_day(monkeypatch, date(2026, 10, 1) + timedelta(days=mod.EXHAUSTED_RETRY_DAYS))
    assert mod.backfill_missing_raw(sleep_sec=0) == 1  # 유예 후 재시도 → 채워짐
    assert "H1" not in env["ledger"]


def test_nodata_code_counts_as_not_found(env: dict[str, Any]) -> None:
    env["missing"] = ["H1"]
    env["behavior"] = {"H1": KraApiError("KRA API error 03: NODATA_ERROR", code="03")}
    assert mod.backfill_missing_raw(sleep_sec=0) == 0  # not-found 는 오류 아님 → raise 없음
    assert env["ledger"]["H1"]["n"] == 1
    assert env["ledger"]["H1"]["reason"] == "nodata_03"


def test_unmappable_item_counts_as_not_found(
    env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    env["missing"] = ["H1"]
    env["behavior"] = {"H1": {"hrNo": ""}}
    monkeypatch.setattr(mod, "upsert_horses", lambda items: 0)
    assert mod.backfill_missing_raw(sleep_sec=0) == 0
    assert env["ledger"]["H1"]["n"] == 1
    assert env["ledger"]["H1"]["reason"] == "unmappable"


@pytest.mark.parametrize(
    "exc",
    [
        _http_error(500),
        _http_error(503),
        httpx.ReadTimeout("timed out"),
        KraApiError("KRA API error 99: SERVICE ERROR", code="99"),
    ],
)
def test_transient_errors_do_not_count(env: dict[str, Any], exc: BaseException) -> None:
    env["missing"] = ["H1", "H2"]
    env["ledger"] = {"H1": {"n": 2, "last": "2026-11-01", "reason": "empty"}}
    env["behavior"] = {"H1": exc, "H2": _ok("H2")}

    assert mod.backfill_missing_raw(sleep_sec=0) == 1  # 일부 실패 = 경고, raise 없음
    assert env["ledger"]["H1"]["n"] == 2  # 장애는 횟수 불변
    assert "last_error" in env["ledger"]["H1"]
    # 반복 장애에도 exhausted 되지 않음
    for _ in range(3):
        mod.backfill_missing_raw(sleep_sec=0)
    assert env["ledger"]["H1"]["n"] == 2
    assert "H1" in _calls(env)


def test_quota_stops_immediately_and_does_not_count(env: dict[str, Any]) -> None:
    env["missing"] = ["H1", "H2", "H3"]
    env["behavior"] = {
        "H1": _ok("H1"),
        "H2": _http_error(429),
        "H3": _ok("H3"),
    }
    assert mod.backfill_missing_raw(sleep_sec=0) == 1
    assert _calls(env) == ["H1", "H2"]  # 쿼터 뒤로는 호출 안 함
    assert "H2" not in env["ledger"]


def test_exhausted_excluded_before_limit(env: dict[str, Any]) -> None:
    env["missing"] = ["H1", "H2", "H3"]
    env["ledger"] = {"H1": {"n": 3, "last": "2026-11-01", "reason": "empty"}}
    env["behavior"] = {"H2": _ok("H2"), "H3": _ok("H3")}
    assert mod.backfill_missing_raw(limit=1, sleep_sec=0) == 1
    assert _calls(env) == ["H2"]  # exhausted H1 이 limit 슬롯을 먹지 않음


def test_ledger_pruned_when_raw_filled(env: dict[str, Any]) -> None:
    env["missing"] = ["H2"]
    env["ledger"] = {
        "H1": {"n": 3, "last": "2026-11-01", "reason": "empty"},  # 다른 경로로 raw 채워짐
        "H2": {"n": 1, "last": "2026-11-01", "reason": "empty"},
    }
    env["behavior"] = {"H2": _ok("H2")}
    assert mod.backfill_missing_raw(sleep_sec=0) == 1
    assert env["ledger"] == {}  # H1 정리, H2 는 성공으로 제거


# ------------------------------------------------------------ fail-loud


def test_backfill_all_failed_raises(env: dict[str, Any]) -> None:
    env["missing"] = ["H1", "H2"]
    env["behavior"] = {"H1": _http_error(500), "H2": httpx.ConnectError("refused")}
    with pytest.raises(RuntimeError, match="전부 실패"):
        mod.backfill_missing_raw(sleep_sec=0)
    assert _calls(env) == ["H1", "H2"]


def test_backfill_quota_on_first_call_raises(env: dict[str, Any]) -> None:
    env["missing"] = ["H1", "H2"]
    env["behavior"] = {"H1": KraApiError("KRA API error 22: LIMITED", code="22")}
    with pytest.raises(RuntimeError, match="quota_hit=True"):
        mod.backfill_missing_raw(sleep_sec=0)
    assert _calls(env) == ["H1"]


def test_backfill_legit_zero_is_fine(env: dict[str, Any]) -> None:
    assert mod.backfill_missing_raw(sleep_sec=0) == 0  # 대상 없음
    assert env["clients"] == []
    env["missing"] = ["H1"]
    env["behavior"] = {"H1": None}
    assert mod.backfill_missing_raw(sleep_sec=0) == 0  # not-found 만 → 정상


@contextmanager
def _fake_session(rows: list[str]):
    class _Result:
        def scalars(self) -> list[str]:
            return list(rows)

    class _Session:
        def execute(self, *_a: Any, **_k: Any) -> _Result:
            return _Result()

    yield _Session()


def test_refresh_all_failed_raises(env: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mod, "session_scope", lambda: _fake_session(["H1", "H2"]))
    env["behavior"] = {"H1": _http_error(502), "H2": httpx.ReadTimeout("t")}
    with pytest.raises(RuntimeError, match="refresh_stale_horses"):
        mod.refresh_stale_horses(sleep_sec=0)


def test_refresh_partial_and_not_found_ok(
    env: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(mod, "session_scope", lambda: _fake_session(["H1", "H2", "H3"]))
    env["behavior"] = {"H1": _http_error(500), "H2": None, "H3": _ok("H3")}
    assert mod.refresh_stale_horses(sleep_sec=0) == 1
    # not-found 만 있어도 오류 아님
    monkeypatch.setattr(mod, "session_scope", lambda: _fake_session(["H2"]))
    assert mod.refresh_stale_horses(sleep_sec=0) == 0
