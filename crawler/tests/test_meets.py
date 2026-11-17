"""영천(meet 4) — 코드↔라벨 단일 진실원과 클라이언트 정규화."""
from __future__ import annotations

import pytest

from src import meets
from src.clients import race_chulma, race_dividend, race_result, race_sales, race_today_html
from src.clients.kma_asos import ALL_STATIONS, MEET_TO_STATION
from src.jobs import chunked_backfill_dividends, sync_race_dividends


def test_meet_codes_include_yeongcheon() -> None:
    assert meets.MEET_CODES == (1, 2, 3, 4)
    assert meets.MEET_NAMES["4"] == "영천"
    assert meets.MEET_CODE_BY_NAME["영천"] == 4
    # 부경은 테이블에 따라 "부산경남"으로도 저장 — 둘 다 3
    assert meets.MEET_CODE_BY_NAME["부산경남"] == meets.MEET_CODE_BY_NAME["부경"] == 3


@pytest.mark.parametrize("raw", ["4", "영천"])
def test_clients_normalize_meet4(raw: str) -> None:
    assert race_result.api_item_to_race_result_fields({"meet": raw})["meet"] == "영천"
    assert race_chulma.api_item_to_race_entry_fields({"meet": raw})["meet"] == "영천"
    assert race_dividend._meet_name({"meet": raw}) == "영천"
    assert race_sales._meet_to_name(raw) == "영천"


def test_race_sales_accepts_int_meet4() -> None:
    assert race_sales._meet_to_name(4) == "영천"


def test_today_html_keeps_meet4_anchor() -> None:
    html = (
        '<a class="raceDetail" data-meet="4" data-rcNo="1" data-rcDate="20261115"'
        ' data-stTime="11:00" data-rcDist="1200" data-rcName="일반">1R</a>'
        '<a class="raceDetail" data-meet="9" data-rcNo="1" data-rcDate="20261115">x</a>'
    )
    rows = race_today_html.parse_html(html)
    assert [(r["race_date"], r["meet"], r["race_no"]) for r in rows] == [
        ("2026-11-15", "영천", 1)
    ]


def test_dividend_paths_know_yeongcheon() -> None:
    assert 4 in tuple(sync_race_dividends.sync_date_all_meets.__defaults__[0])
    assert chunked_backfill_dividends._MEET_CODE["영천"] == 4
    assert "부산경남" not in chunked_backfill_dividends._MEET_CODE  # race_results 는 "부경"


def test_weather_station_for_yeongcheon() -> None:
    assert MEET_TO_STATION["영천"] == 281
    assert set(ALL_STATIONS) == set(MEET_TO_STATION.values())
