"""sync_race_plan 연도 선택 + 내년도 NODATA 허용 로직."""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pytest

from src.clients.kra_base import KraApiError, KraClient
from src.jobs import sync_race_plan as mod


def _fake_datetime(utc_now: datetime) -> type[datetime]:
    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return utc_now.astimezone(tz) if tz else utc_now.replace(tzinfo=None)

    return _FakeDatetime


def _no_data_error() -> KraApiError:
    # 실제 data.go.kr NODATA 응답을 kra_base 파서에 태워 동일 경로로 예외 생성
    payload = {"response": {"header": {"resultCode": "03", "resultMsg": "NODATA_ERROR"}}}
    with pytest.raises(KraApiError) as ei:
        KraClient._raise_for_api_error(payload)
    return ei.value


# ------------------------------------------------------------ 연도 선택 (clock mock)


@pytest.mark.parametrize(
    ("utc_now", "expected"),
    [
        (datetime(2026, 11, 6, 3, 0, tzinfo=UTC), [2026, 2027]),  # 11월
        (datetime(2026, 12, 20, 3, 0, tzinfo=UTC), [2026, 2027]),  # 12월
        (datetime(2027, 1, 2, 3, 0, tzinfo=UTC), [2027]),  # 1월
        (datetime(2026, 6, 15, 3, 0, tzinfo=UTC), [2026]),  # 6월
        # UTC 10/31 20:00 = KST 11/1 05:00 — 컨테이너 TZ 가 UTC 여도 KST 로 11월
        (datetime(2026, 10, 31, 20, 0, tzinfo=UTC), [2026, 2027]),
        # UTC 12/31 20:00 = KST 1/1 05:00 — 새해 첫날엔 새 연도만
        (datetime(2026, 12, 31, 20, 0, tzinfo=UTC), [2027]),
    ],
)
def test_scheduled_years_by_kst_clock(monkeypatch, utc_now, expected):
    monkeypatch.setattr(mod, "datetime", _fake_datetime(utc_now))
    calls: list[tuple[int, bool]] = []

    def fake_sync_year(year: int, *, meet=None, allow_no_data: bool = False) -> int:
        calls.append((year, allow_no_data))
        return 1

    monkeypatch.setattr(mod, "sync_year", fake_sync_year)

    assert mod.target_years(mod.kst_today()) == expected
    assert mod.sync_scheduled_years() == len(expected)
    # 올해는 strict, 내년도만 NODATA 허용
    assert calls == [(expected[0], False)] + [(y, True) for y in expected[1:]]


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 10, 31), [2026]),
        (date(2026, 11, 1), [2026, 2027]),
        (date(2026, 12, 31), [2026, 2027]),
        (date(2027, 1, 1), [2027]),
    ],
)
def test_target_years_boundaries(today, expected):
    assert mod.target_years(today) == expected


# ------------------------------------------------------------ 클라이언트 mock


class _FakeClient:
    """year → items(list) 또는 Exception 매핑. meet 무관."""

    def __init__(self, by_year: dict[int, Any]) -> None:
        self.by_year = by_year
        self.calls: list[tuple[int, int | None]] = []

    def __call__(self) -> _FakeClient:  # RaceAnnualPlanClient() 대체
        return self

    def __enter__(self) -> _FakeClient:
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def list_by_year(self, year: int, *, meet: int | None = None) -> list[dict[str, Any]]:
        self.calls.append((year, meet))
        v = self.by_year[year]
        if isinstance(v, Exception):
            raise v
        return v


def _item(year: int, name: str) -> dict[str, Any]:
    return {"meet": "1", "rc_year": str(year), "rc_name": name, "rc_date": f"{year}0607"}


@pytest.fixture
def upserted(monkeypatch) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def fake_upsert(items: list[dict[str, Any]]) -> int:
        rows.extend(items)
        return len(items)

    monkeypatch.setattr(mod, "upsert_race_plans", fake_upsert)
    return rows


def _install(monkeypatch, by_year: dict[int, Any]) -> _FakeClient:
    client = _FakeClient(by_year)
    monkeypatch.setattr(mod, "RaceAnnualPlanClient", client)
    return client


def test_next_year_no_data_is_ok(monkeypatch, upserted):
    client = _install(monkeypatch, {2026: [_item(2026, "코리아컵")], 2027: _no_data_error()})
    n = mod.sync_scheduled_years(date(2026, 12, 1))
    assert n == 3  # 올해 3개 meet × 1건, 내년도 0건
    assert {y for y, _ in client.calls} == {2026, 2027}
    assert all(r["year"] == 2026 for r in upserted)


def test_next_year_empty_is_ok(monkeypatch, upserted):
    _install(monkeypatch, {2026: [_item(2026, "코리아컵")], 2027: []})
    assert mod.sync_scheduled_years(date(2026, 11, 15)) == 3


def test_next_year_published_is_upserted(monkeypatch, upserted):
    _install(monkeypatch, {2026: [_item(2026, "코리아컵")], 2027: [_item(2027, "그랑프리")]})
    assert mod.sync_scheduled_years(date(2026, 12, 10)) == 6
    assert {r["year"] for r in upserted} == {2026, 2027}


def test_current_year_no_data_fails_loudly(monkeypatch, upserted):
    client = _install(monkeypatch, {2026: _no_data_error(), 2027: [_item(2027, "그랑프리")]})
    with pytest.raises(KraApiError):
        mod.sync_scheduled_years(date(2026, 12, 10))
    assert all(y == 2026 for y, _ in client.calls)  # 내년도까지 가지 않음


def test_next_year_other_api_error_still_fails(monkeypatch, upserted):
    # 한도 초과 등 NODATA 가 아닌 에러는 내년도라도 실패로 기록
    err = KraApiError("KRA API error 22: LIMITED_NUMBER_OF_SERVICE_REQUESTS", code="22")
    _install(monkeypatch, {2026: [_item(2026, "코리아컵")], 2027: err})
    with pytest.raises(KraApiError):
        mod.sync_scheduled_years(date(2026, 11, 20))


def test_june_does_not_touch_next_year(monkeypatch, upserted):
    client = _install(monkeypatch, {2026: [_item(2026, "코리아컵")]})
    assert mod.sync_scheduled_years(date(2026, 6, 1)) == 3
    assert {y for y, _ in client.calls} == {2026}
