"""단위 루프 잡의 fail-loud — 전부 예외면 raise, 일부 실패·정상 0건은 통과."""
from __future__ import annotations

import dataclasses
import importlib
import sys
import types
from datetime import UTC, date, datetime
from typing import Any

import pytest

from src.clients.kra_base import KraApiError
from src.clients.naver_news import NaverNewsItem
from src.jobs import (
    sync_naver_news,
    sync_race_corners,
    sync_race_entries,
    sync_race_info,
    sync_race_sales,
    sync_videos_backfill,
    sync_weather,
)
from src.jobs._failloud import UnitFailures

BOOM = RuntimeError("HTTP 500 serviceKey=SECRETKEY123 boom")
NODATA = KraApiError("KRA API error 03: NODATA_ERROR", code="03")


class _Fake:
    """`Client()` / `Client(*args)` + context manager 대체. respond(*args) → 값 또는 예외."""

    def __init__(self, respond) -> None:
        self.respond = respond
        self.calls: list[tuple] = []

    def __call__(self, *_a: Any, **_k: Any) -> _Fake:
        return self

    def __enter__(self) -> _Fake:
        return self

    def __exit__(self, *_: object) -> None:
        pass

    def _call(self, *args: Any) -> Any:
        self.calls.append(args)
        v = self.respond(*args)
        if isinstance(v, BaseException):
            raise v
        return v

    # 잡별 클라이언트 메서드 — 모두 같은 응답 함수로
    def list_by_date(self, d: date, meet: int | None = None) -> Any:
        return self._call(d, meet)

    def list_by_year(self, year: int, meet: int | None = None) -> Any:
        return self._call(year, meet)

    def fetch_hourly(self, stn: int, start: datetime, end: datetime) -> Any:
        return self._call(stn)

    def search(self, kw: str, **_: Any) -> Any:
        return self._call(kw)

    def search_videos(self, query: str, **_: Any) -> Any:
        return self._call(query)


def _count_upsert(items: list[Any]) -> int:
    return len(items)


# ------------------------------------------------------------ helper


def test_helper_message_is_short_and_redacted():
    f = UnitFailures("x")
    f.fail(RuntimeError("serviceKey=SECRETKEY123 " + "y" * 500), "x_failed")
    f.fail(BOOM, "x_failed")
    with pytest.raises(RuntimeError) as ei:
        f.raise_if_all_failed()
    msg = str(ei.value)
    assert "2개 단위 전부 실패" in msg
    assert "SECRETKEY123" not in msg
    assert len(msg) < 300


def test_helper_nothing_attempted_is_ok():
    UnitFailures("x").raise_if_all_failed()


# ------------------------------------------------------------ race_entries


@pytest.fixture
def entries(monkeypatch):
    monkeypatch.setattr(sync_race_entries, "upsert_race_entries", _count_upsert)
    monkeypatch.setattr(sync_race_entries, "upsert_races_skeleton", _count_upsert)
    # api 매핑은 그대로 쓰지 않고 item 통과
    monkeypatch.setattr(sync_race_entries, "api_item_to_race_entry_fields", lambda it: it)

    def install(respond) -> _Fake:
        fake = _Fake(respond)
        monkeypatch.setattr(sync_race_entries, "RaceChulmaClient", fake)
        return fake

    return install


def test_entries_all_fail_raises(entries):
    fake = entries(lambda d, m: BOOM)
    with pytest.raises(RuntimeError, match="race_entries"):
        sync_race_entries.sync_upcoming(days_ahead=10)
    assert len(fake.calls) >= 3


def test_entries_partial_fail_returns_rows(entries):
    entries(lambda d, m: BOOM if m == 1 else [{"x": 1}, {"x": 2}])
    n = sync_race_entries.sync_upcoming(days_ahead=10)
    dates = sync_race_entries._upcoming_race_dates(date.today(), 10)
    assert n == 2 * 2 * len(dates)  # meet 2·3 × 2건 × 일자 수


def test_entries_all_empty_is_ok(entries):
    entries(lambda d, m: [])
    assert sync_race_entries.sync_upcoming(days_ahead=10) == 0


def test_entries_all_nodata_is_ok(entries):
    # 휴장·미발표 기간 — KRA NODATA 는 실패가 아니라 0건
    entries(lambda d, m: NODATA)
    assert sync_race_entries.sync_upcoming(days_ahead=10) == 0


# ------------------------------------------------------------ race_sales / race_corners

_MEET_JOBS = [
    (sync_race_sales, "RaceSalesClient", "upsert_race_sales", "race_sales"),
    (sync_race_corners, "RaceResultCornerClient", "upsert_corners", "race_corners"),
]


@pytest.fixture(params=_MEET_JOBS, ids=lambda p: p[3])
def meet_job(request, monkeypatch):
    mod, client_attr, upsert_attr, name = request.param
    monkeypatch.setattr(mod, upsert_attr, _count_upsert)

    def install(respond) -> _Fake:
        fake = _Fake(respond)
        monkeypatch.setattr(mod, client_attr, fake)
        return fake

    return mod, install, name


def test_meets_all_fail_raises(meet_job):
    mod, install, name = meet_job
    fake = install(lambda d, m: BOOM)
    with pytest.raises(RuntimeError, match=f"{name}: 시도한 3개"):
        mod.sync_date_all_meets(date(2026, 11, 1))
    assert [m for _, m in fake.calls] == [1, 2, 3]


def test_meets_partial_fail_returns_rows(meet_job):
    mod, install, _ = meet_job
    install(lambda d, m: BOOM if m == 2 else [{"i": 1}])
    assert mod.sync_date_all_meets(date(2026, 11, 1)) == 2


def test_meets_all_empty_is_ok(meet_job):
    mod, install, _ = meet_job
    install(lambda d, m: [])
    assert mod.sync_date_all_meets(date(2026, 11, 2)) == 0


def test_meets_nodata_is_ok(meet_job):
    # 22:50/22:55 는 비경주일에도 돈다 — NODATA 응답이면 0건 success
    mod, install, _ = meet_job
    install(lambda d, m: NODATA)
    assert mod.sync_date_all_meets(date(2026, 11, 3)) == 0


def test_backfill_all_days_fail_raises(meet_job):
    mod, install, name = meet_job
    install(lambda d, m: BOOM)
    with pytest.raises(RuntimeError, match=f"{name}_backfill"):
        mod.backfill_recent_days(days=3)


def test_backfill_partial_days_ok(meet_job):
    mod, install, _ = meet_job
    today = date.today()
    install(lambda d, m: BOOM if d == today else [{"i": 1}])
    assert mod.backfill_recent_days(days=3) == 2 * 3  # 이틀 × 3 meet


# ------------------------------------------------------------ weather


@pytest.fixture
def weather(monkeypatch):
    monkeypatch.setattr(sync_weather, "upsert_weather", _count_upsert)
    monkeypatch.setattr(sync_weather, "api_item_to_weather_fields", lambda it: it)

    def install(respond) -> _Fake:
        fake = _Fake(respond)
        monkeypatch.setattr(sync_weather, "KmaAsosClient", fake)
        return fake

    return install


def test_weather_all_stations_fail_raises(weather):
    fake = weather(lambda stn: BOOM)
    with pytest.raises(RuntimeError, match="weather"):
        sync_weather.sync_range(date(2026, 11, 1), date(2026, 11, 2))
    assert len(fake.calls) == len(sync_weather.ALL_STATIONS)


def test_weather_partial_fail_returns_rows(weather):
    first = sync_weather.ALL_STATIONS[0]
    weather(lambda stn: BOOM if stn == first else [{"r": 1}, {"r": 2}])
    n = sync_weather.sync_range(date(2026, 11, 1), date(2026, 11, 2))
    assert n == 2 * (len(sync_weather.ALL_STATIONS) - 1)


def test_weather_all_empty_is_ok(weather):
    weather(lambda stn: [])
    assert sync_weather.sync_range(date(2026, 11, 1), date(2026, 11, 2)) == 0


# ------------------------------------------------------------ naver news


def _news(guid: str) -> NaverNewsItem:
    return NaverNewsItem(
        guid=guid, title=guid, summary=None, link=guid, source="s",
        published_at=datetime(2026, 11, 1, tzinfo=UTC),
    )


@pytest.fixture
def naver(monkeypatch):
    monkeypatch.setattr(
        sync_naver_news, "settings",
        dataclasses.replace(
            sync_naver_news.settings,
            naver_search_client_id="id", naver_search_client_secret="secret",
        ),
    )
    monkeypatch.setattr(sync_naver_news, "_upsert", _count_upsert)

    def install(respond) -> _Fake:
        fake = _Fake(respond)
        monkeypatch.setattr(sync_naver_news, "NaverNewsSearchClient", fake)
        return fake

    return install


def test_naver_all_keywords_fail_raises(naver):
    naver(lambda kw: BOOM)
    with pytest.raises(RuntimeError, match="naver_news"):
        sync_naver_news.sync_naver_news()


def test_naver_partial_fail_returns_rows(naver):
    naver(lambda kw: BOOM if kw == "경마" else [_news(f"{kw}-1"), _news("shared")])
    assert sync_naver_news.sync_naver_news() == 3  # 2 키워드 × 1 + 공통 1


def test_naver_all_empty_is_ok(naver):
    naver(lambda kw: [])
    assert sync_naver_news.sync_naver_news() == 0


# ------------------------------------------------------------ videos backfill


@pytest.fixture
def videos(monkeypatch):
    missing = [
        {"race_date": date(2026, 11, 1), "meet": "서울", "race_no": n} for n in (1, 2, 3)
    ]
    monkeypatch.setattr(sync_videos_backfill, "_find_missing", lambda *_: missing)
    monkeypatch.setattr(sync_videos_backfill, "upsert_videos", _count_upsert)

    def install(respond) -> _Fake:
        fake = _Fake(respond)
        monkeypatch.setattr(sync_videos_backfill, "YoutubeClient", fake)
        return fake

    return install


def test_videos_all_search_fail_raises(videos):
    videos(lambda q: BOOM)
    with pytest.raises(RuntimeError, match="videos_backfill: 시도한 3개"):
        sync_videos_backfill.backfill_missing_race_videos()


def test_videos_partial_fail_returns_rows(videos):
    videos(lambda q: BOOM if "1경주" in q else ["v"])
    assert sync_videos_backfill.backfill_missing_race_videos() == 2


def test_videos_no_match_is_ok(videos):
    videos(lambda q: [])
    assert sync_videos_backfill.backfill_missing_race_videos() == 0


# ------------------------------------------------------------ race_info 주간 canary (API187)


@pytest.fixture
def race_info(monkeypatch):
    def use(respond):
        fake = _Fake(respond)
        monkeypatch.setattr(sync_race_info, "RaceInfoClient", fake)
        return fake

    return use


def test_race_info_all_meets_fail_raises(race_info):
    fake = race_info(lambda y, m: BOOM)
    with pytest.raises(RuntimeError, match="race_info: 시도한 3개 단위 전부 실패") as ei:
        sync_race_info.backfill_races_metadata(2026)
    assert "SECRETKEY123" not in str(ei.value)
    assert [m for _, m in fake.calls] == [1, 2, 3]


def test_race_info_partial_fail_is_ok(race_info):
    race_info(lambda y, m: BOOM if m == 2 else [])
    assert sync_race_info.backfill_races_metadata(2026) == 0


def test_race_info_empty_response_is_ok(race_info):
    # 2026-05~ API187 의 실제 상태 — 빈 응답은 canary 정상 0건
    race_info(lambda y, m: [])
    assert sync_race_info.backfill_races_metadata(2026) == 0


def test_race_info_nodata_is_ok(race_info):
    race_info(lambda y, m: NODATA)
    assert sync_race_info.backfill_races_metadata(2026) == 0


# ------------------------------------------------------------ periodic 진입점 전파


@pytest.fixture
def periodic(monkeypatch):
    """crawler_core 가짜 모듈로 monitoring·periodic 재import → @track_job 경로 그대로."""
    calls: list[dict] = []
    client = types.SimpleNamespace(
        safe_register=lambda **kw: None,
        safe_start_run=lambda job_key: 1,
        safe_finish_run=lambda run_id, **kw: calls.append(kw),
    )
    pkg = types.ModuleType("crawler_core")
    pkg.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crawler_core", pkg)
    monkeypatch.setitem(sys.modules, "crawler_core.client", client)  # type: ignore[arg-type]
    monkeypatch.delitem(sys.modules, "src.monitoring", raising=False)
    monkeypatch.delitem(sys.modules, "src.jobs.periodic", raising=False)
    mod = importlib.import_module("src.jobs.periodic")
    yield mod, calls
    # 다른 테스트가 원래 모듈을 쓰도록 정리
    sys.modules.pop("src.jobs.periodic", None)
    sys.modules.pop("src.monitoring", None)


def test_periodic_entrypoints_propagate_all_fail(periodic, monkeypatch):
    mod, calls = periodic
    monkeypatch.setattr(sync_race_sales, "RaceSalesClient", _Fake(lambda d, m: BOOM))
    monkeypatch.setattr(sync_race_corners, "RaceResultCornerClient", _Fake(lambda d, m: BOOM))
    monkeypatch.setattr(sync_weather, "KmaAsosClient", _Fake(lambda stn: BOOM))
    monkeypatch.setattr(mod, "settings", dataclasses.replace(
        mod.settings, kra_chulma_operation="entrySheet_2",
        youtube_api_key="k", youtube_krbc_channel_id="c",
    ))
    monkeypatch.setattr(sync_race_entries, "RaceChulmaClient", _Fake(lambda d, m: BOOM))
    monkeypatch.setattr(
        sync_naver_news, "settings",
        dataclasses.replace(
            sync_naver_news.settings,
            naver_search_client_id="id", naver_search_client_secret="secret",
        ),
    )
    monkeypatch.setattr(sync_naver_news, "NaverNewsSearchClient", _Fake(lambda kw: BOOM))
    monkeypatch.setattr(
        sync_videos_backfill, "_find_missing",
        lambda *_: [{"race_date": date(2026, 11, 1), "meet": "서울", "race_no": 1}],
    )
    monkeypatch.setattr(sync_videos_backfill, "YoutubeClient", _Fake(lambda q: BOOM))
    monkeypatch.setattr(sync_race_info, "RaceInfoClient", _Fake(lambda y, m: BOOM))

    runs = [
        mod.run_sync_race_sales,
        mod.run_sync_race_corners,
        mod.run_sync_weather,
        mod.run_sync_race_entries,
        mod.run_sync_news,
        mod.run_sync_videos_backfill,
        mod.run_sync_race_info,
    ]
    for run in runs:
        with pytest.raises(RuntimeError, match="전부 실패"):
            run()
    assert [c["status"] for c in calls] == ["failed"] * len(runs)
    assert all("SECRETKEY123" not in c["error_message"] for c in calls)
