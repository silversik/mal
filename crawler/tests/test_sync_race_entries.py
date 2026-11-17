"""sync_race_entries 경주일 선택 — 요일 하드코딩 없이 공휴일 경주일(월)도 조회."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from src.clients.kra_base import KraApiError
from src.jobs import sync_race_entries as mod

KST = ZoneInfo("Asia/Seoul")
HOLIDAY = date(2026, 10, 5)  # 월 — 개천절 대체공휴일, 17경주 개최 (출전표 0건 사고)


def _d(s: str) -> date:
    return date.fromisoformat(s)


# ------------------------------------------------------------ date selection


def test_holiday_monday_is_probed_from_the_preceding_thursday() -> None:
    got = mod._upcoming_race_dates(date(2026, 10, 1), days_ahead=10)  # 목
    assert got == [_d(x) for x in (
        "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",  # 매일 (+0~+4)
        "2026-10-09", "2026-10-10", "2026-10-11",  # 그 뒤는 금/토/일
    )]
    assert HOLIDAY in got


@pytest.mark.parametrize("base", ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
                                  "2026-10-05"])
def test_holiday_probed_on_every_day_entries_can_exist(base: str) -> None:
    # 출전표는 경주일 ~3일 전 공표 — 그 이후 모든 실행에서 월요일을 조회해야 한다.
    assert HOLIDAY in mod._upcoming_race_dates(_d(base), days_ahead=10)


def test_normal_week_keeps_all_weekend_dates() -> None:
    base = date(2026, 11, 17)  # 화
    got = mod._upcoming_race_dates(base, days_ahead=10)
    assert got == [_d(x) for x in (
        "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21",
        "2026-11-22", "2026-11-27",
    )]
    old = [base + timedelta(days=i) for i in range(11)
           if (base + timedelta(days=i)).weekday() in (4, 5, 6)]
    assert set(old) <= set(got)


def test_days_ahead_shorter_than_probe_window() -> None:
    assert mod._upcoming_race_dates(date(2026, 11, 17), days_ahead=0) == [date(2026, 11, 17)]
    assert mod._upcoming_race_dates(date(2026, 11, 17), days_ahead=2) == [
        date(2026, 11, 17), date(2026, 11, 18), date(2026, 11, 19)]


@pytest.mark.parametrize("kw", [{"days_ahead": -1}, {"probe_days": -1}])
def test_negative_window_raises(kw: dict[str, int]) -> None:
    with pytest.raises(ValueError):
        mod._upcoming_race_dates(date(2026, 11, 17), **kw)


# ------------------------------------------------------------ sync_upcoming


def _item(d: date, meet: int, rc_no: int, hr_no: str) -> dict[str, Any]:
    return {"rcDate": d.strftime("%Y%m%d"), "meet": str(meet), "rcNo": str(rc_no),
            "chulNo": "1", "hrNo": hr_no, "hrName": "말"}


class FakeClient:
    """responses[(date, meet)] = list | Exception. 없으면 NODATA."""

    responses: dict[tuple[date, int], Any] = {}
    calls: list[tuple[date, int]] = []

    def __enter__(self) -> FakeClient:
        return self

    def __exit__(self, *a: Any) -> None:
        return None

    def list_by_date(self, d: date, meet: int) -> list[dict[str, Any]]:
        FakeClient.calls.append((d, meet))
        res = FakeClient.responses.get((d, meet))
        if res is None:
            raise KraApiError("KRA API error 03: NODATA_ERROR", code="03")
        if isinstance(res, Exception):
            raise res
        return res


@pytest.fixture
def env(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    state: dict[str, Any] = {
        "entries": [], "skeleton": [], "now": datetime(2026, 10, 2, 9, tzinfo=KST)}

    class _Clock(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
            n: datetime = state["now"]
            return n.astimezone(tz) if tz else n

    FakeClient.responses = {}
    FakeClient.calls = []
    monkeypatch.setattr(mod, "datetime", _Clock)
    monkeypatch.setattr(mod, "RaceChulmaClient", FakeClient)

    def fake_upsert(rows: list[dict[str, Any]]) -> int:
        state["entries"].extend(rows)
        return len(rows)

    monkeypatch.setattr(mod, "upsert_race_entries", fake_upsert)
    monkeypatch.setattr(mod, "upsert_races_skeleton",
                        lambda rows: state["skeleton"].extend(rows) or len(rows))
    return state


def test_holiday_entries_are_upserted(env: dict[str, Any]) -> None:
    FakeClient.responses = {
        (date(2026, 10, 3), 1): [_item(date(2026, 10, 3), 1, 1, "0001")],
        (HOLIDAY, 1): [_item(HOLIDAY, 1, 1, "0002"), _item(HOLIDAY, 1, 2, "0003")],
        (HOLIDAY, 3): [_item(HOLIDAY, 3, 1, "0004")],
    }
    n = mod.sync_upcoming(days_ahead=10)
    assert n == 4
    assert {(r["race_date"], r["meet"]) for r in env["entries"]} == {
        (date(2026, 10, 3), "서울"), (HOLIDAY, "서울"), (HOLIDAY, "부경")}
    assert {(r["race_date"], r["race_no"]) for r in env["skeleton"]} >= {(HOLIDAY, 1), (HOLIDAY, 2)}
    assert {(HOLIDAY, m) for m in (1, 2, 3)} <= set(FakeClient.calls)


def test_all_nodata_is_zero_not_failure(env: dict[str, Any]) -> None:
    assert mod.sync_upcoming(days_ahead=10) == 0  # 전부 NODATA → 경주 없음 (정상)


def test_unknown_date_fails_loudly_after_other_dates(env: dict[str, Any]) -> None:
    boom = RuntimeError("HTTP 500")
    FakeClient.responses = {
        (HOLIDAY, 1): boom, (HOLIDAY, 2): boom, (HOLIDAY, 3): boom,
        (date(2026, 10, 9), 1): [_item(date(2026, 10, 9), 1, 1, "0001")],
    }
    with pytest.raises(RuntimeError, match="경주일 확인 불가.*2026-10-05"):
        mod.sync_upcoming(days_ahead=10)
    # 미확인 날짜 이후의 날짜도 끝까지 수집한 뒤 실패한다
    assert [r["race_date"] for r in env["entries"]] == [date(2026, 10, 9)]


def test_single_meet_failure_is_only_a_warning(env: dict[str, Any]) -> None:
    FakeClient.responses = {
        (HOLIDAY, 2): RuntimeError("HTTP 500"),
        (HOLIDAY, 3): [_item(HOLIDAY, 3, 1, "0004")],
    }
    assert mod.sync_upcoming(days_ahead=10) == 1


def test_unknown_date_error_is_redacted(env: dict[str, Any]) -> None:
    boom = RuntimeError("GET https://apis.data.go.kr/x?serviceKey=SECRETKEY123 500")
    FakeClient.responses = {(HOLIDAY, m): boom for m in (1, 2, 3)}
    with pytest.raises(RuntimeError) as ei:
        mod.sync_upcoming(days_ahead=10)
    assert "SECRETKEY123" not in str(ei.value)


def test_uses_kst_today_not_utc(env: dict[str, Any]) -> None:
    # 2026-10-05 00:30 KST = 2026-10-04 15:30 UTC — 조회는 KST 오늘(월)부터.
    env["now"] = datetime(2026, 10, 4, 15, 30, tzinfo=ZoneInfo("UTC"))
    mod.sync_upcoming(days_ahead=10)
    assert min(d for d, _ in FakeClient.calls) == HOLIDAY
