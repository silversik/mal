"""경마장(meet) 코드↔라벨 단일 진실원과 수집 시점 라벨 정규화."""
from __future__ import annotations

import pytest

from src import meets
from src.clients import (
    horse_rank_change,
    horse_rating,
    jockey,
    jockey_change,
    owner,
    race_annual_plan,
    race_chulma,
    race_dividend,
    race_result,
    race_sales,
    race_today_html,
    trainer,
)
from src.clients.kma_asos import ALL_STATIONS, MEET_TO_STATION
from src.jobs import chunked_backfill_dividends, sync_race_dividends


def test_meet_codes_include_yeongcheon() -> None:
    assert meets.MEET_CODES == (1, 2, 3, 4)
    assert meets.MEET_NAMES["4"] == "영천"
    assert meets.MEET_CODE_BY_NAME["영천"] == 4
    # 정리 전 행은 별칭 라벨로 남아 있다 — 읽는 쪽 역매핑은 별칭도 받는다
    assert meets.MEET_CODE_BY_NAME["부산경남"] == meets.MEET_CODE_BY_NAME["부경"] == 3
    assert meets.MEET_CODE_BY_NAME["양천"] == meets.MEET_CODE_BY_NAME["영천"] == 4


# ------------------------------------------------------------ normalize_meet

CANONICAL = {"서울", "제주", "부경", "영천"}


@pytest.mark.parametrize(
    ("raw", "label"),
    [
        ("1", "서울"), ("2", "제주"), ("3", "부경"), ("4", "영천"),
        (3, "부경"), (" 3 ", "부경"),
        ("서울", "서울"), ("제주", "제주"), ("부경", "부경"), ("영천", "영천"),
        ("부산경남", "부경"), (" 부산경남 ", "부경"), ("양천", "영천"),
    ],
)
def test_normalize_meet_known_values(raw: object, label: str) -> None:
    assert meets.normalize_meet(raw) == label
    assert meets.meet_label(raw) == label


@pytest.mark.parametrize("raw", [None, "", "  ", "-"])
def test_normalize_meet_blank(raw: object) -> None:
    assert meets.normalize_meet(raw) is None
    # 빈 응답이면 요청한 경마장 라벨
    assert meets.normalize_meet(raw, requested=3) == "부경"


def test_normalize_meet_unknown_text_uses_requested_code() -> None:
    # KRA 가 새 표기·오기를 보내도 요청한 경마장 라벨로 저장 — 라벨이 갈라지지 않는다
    assert meets.normalize_meet("부산경남경마공원", requested=3) == "부경"
    assert meets.normalize_meet("yeongcheon", requested="4") == "영천"


def test_normalize_meet_unknown_text_without_request_is_kept() -> None:
    # 요청 코드가 없으면 행을 버리지 않고 원문 유지 (경고 로그)
    assert meets.normalize_meet("새경마장") == "새경마장"
    assert meets.meet_label("새경마장") is None


def test_normalize_meet_trusts_response_over_request() -> None:
    # API 가 meet 필터를 무시하고 다른 경마장을 돌려주면 응답을 믿는다
    assert meets.normalize_meet("서울", requested=3) == "서울"
    assert meets.normalize_meet("1", requested=3) == "서울"


def test_aliases_point_to_canonical_labels() -> None:
    assert set(meets.MEET_NAMES.values()) == CANONICAL
    assert set(meets.MEET_ALIASES.values()) <= CANONICAL
    assert not set(meets.MEET_ALIASES) & CANONICAL


# ------------------------------------------------------------ 클라이언트 매핑

#: KRA 응답 meet 에 올 수 있는 값 → 저장돼야 하는 라벨
RESPONSE_LABELS = [
    ("3", "부경"), ("부경", "부경"), ("부산경남", "부경"),
    ("4", "영천"), ("영천", "영천"), ("양천", "영천"),
    ("1", "서울"), ("서울", "서울"), ("2", "제주"), ("제주", "제주"),
]


@pytest.mark.parametrize(("raw", "label"), RESPONSE_LABELS)
def test_race_keyed_clients_store_one_label(raw: str, label: str) -> None:
    """경주 키(unique 에 meet 포함) 테이블 — 응답 표기가 달라도 라벨은 하나."""
    assert race_result.api_item_to_race_result_fields({"meet": raw})["meet"] == label
    assert race_chulma.api_item_to_race_entry_fields({"meet": raw})["meet"] == label
    assert race_sales.api_item_to_race_sales_fields({"meet": raw})["meet"] == label
    assert jockey_change.api_item_to_jockey_change_fields({"meet": raw})["meet"] == label
    assert race_dividend._meet_name({"meet": raw}) == label


@pytest.mark.parametrize(("raw", "label"), RESPONSE_LABELS)
def test_entity_clients_store_one_label(raw: str, label: str) -> None:
    """소속 경마장 컬럼(기수·조교사·마주·레이팅·등급변동)도 같은 라벨."""
    assert jockey.api_item_to_jockey_fields({"meet": raw, "jkNo": "1"})["meet"] == label
    assert trainer.api_item_to_trainer_fields({"meet": raw, "trNo": "1"})["meet"] == label
    assert owner.api_item_to_owner_fields({"meet": raw, "owNo": "1"})["meet"] == label
    assert horse_rating.api_item_to_rating_fields({"meet": raw, "hrNo": "1"})["meet"] == label
    assert (
        horse_rank_change.api_item_to_horse_rank_change_fields({"meet": raw})["meet"] == label
    )


@pytest.mark.parametrize(("code", "label"), [(1, "서울"), (2, "제주"), (3, "부경"), (4, "영천")])
@pytest.mark.parametrize("raw", ["알 수 없는 표기", "", None])
def test_race_keyed_clients_fall_back_to_requested_meet(
    raw: object, code: int, label: str
) -> None:
    item = {"meet": raw}
    assert race_result.api_item_to_race_result_fields(item, meet=code)["meet"] == label
    assert race_chulma.api_item_to_race_entry_fields(item, meet=code)["meet"] == label
    assert race_sales.api_item_to_race_sales_fields(item, meet=code)["meet"] == label
    assert race_dividend._meet_name(item, code) == label


def test_entry_without_any_meet_keeps_placeholder() -> None:
    # race_entries.meet 은 NOT NULL — 응답도 요청 코드도 없으면 기존처럼 "알수없음"
    assert race_chulma.api_item_to_race_entry_fields({})["meet"] == "알수없음"
    assert race_result.api_item_to_race_result_fields({})["meet"] is None


def _dividend_item(pool: str, meet: str, **over: object) -> dict[str, object]:
    return {"rcDate": "20261122", "meet": meet, "rcNo": "1", "pool": pool,
            "chulNo": "3", "odds": "2.5", **over}


def test_dividend_rows_merge_mixed_response_labels() -> None:
    """한 응답 안에서 표기가 섞여도 같은 경주·말은 한 행 (WIN+PLC 합쳐짐)."""
    items = [_dividend_item("WIN", "부산경남"), _dividend_item("PLC", "부경", odds="1.3")]
    rows = race_dividend.items_to_dividend_rows(items, meet=3)
    assert [(r["meet"], r["horse_no"], r["win_rate"], r["plc_rate"]) for r in rows] == [
        ("부경", "3", 2.5, 1.3)
    ]


def test_combo_dividend_rows_use_one_label() -> None:
    items = [
        _dividend_item("QNL", "부산경남", chulNo="1", chulNo2="2"),
        _dividend_item("QNL", "양천", chulNo="1", chulNo2="2"),
        _dividend_item("EXA", "이상한값", chulNo="1", chulNo2="2"),
    ]
    by_req3 = race_dividend.items_to_combo_dividend_rows(items[:1], meet=3)
    by_req4 = race_dividend.items_to_combo_dividend_rows(items[1:], meet=4)
    assert {r["meet"] for r in by_req3} == {"부경"}
    assert {(r["pool"], r["meet"]) for r in by_req4} == {("QNL", "영천"), ("EXA", "영천")}


def test_race_plans_keep_kra_label() -> None:
    """race_plans 만 KRA 원문 유지 — unique 키에 meet 이 있고 웹이 '부산경남' 기준."""
    row = race_annual_plan.api_item_to_race_plan_fields(
        {"meet": "부산경남", "rcName": "부산일보배"}, year=2026
    )
    assert row["meet"] == "부산경남"
    assert race_annual_plan.api_item_to_race_plan_fields({"meet": "3"}, year=2026)["meet"] == "부경"


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
    # gap 백필은 정규 라벨 날짜만 다시 받는다 — 별칭으로 저장된 날짜를 다시 받으면
    # 새 행이 정규 라벨로 들어가 같은 경주가 두 라벨로 중복된다 (기존 행 정리 전까지).
    assert set(chunked_backfill_dividends._MEET_CODE) == CANONICAL


def test_weather_station_for_yeongcheon() -> None:
    assert MEET_TO_STATION["영천"] == 281
    assert set(ALL_STATIONS) == set(MEET_TO_STATION.values())
