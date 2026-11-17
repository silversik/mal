"""race_results 매핑 — jk_no / tr_no 가 raw jkNo / trNo 에서 채워지는지."""
from __future__ import annotations

from src.clients.race_result import api_item_to_race_result_fields


def _item(**over):
    base = {
        "hrNo": "0012345", "rcDate": "20261115", "meet": "1", "rcNo": "3",
        "ord": "2", "jkName": "홍길동", "trName": "김조교",
        "jkNo": "080123", "trNo": "070456",
    }
    base.update(over)
    return base


def test_maps_jk_no_and_tr_no():
    f = api_item_to_race_result_fields(_item())
    assert f["jk_no"] == "080123"
    assert f["tr_no"] == "070456"


def test_numeric_ids_become_strings_and_are_stripped():
    f = api_item_to_race_result_fields(_item(jkNo=80123, trNo=" 070456 "))
    assert f["jk_no"] == "80123"
    assert f["tr_no"] == "070456"


def test_blank_ids_are_none():
    f = api_item_to_race_result_fields(_item(jkNo="", trNo="-"))
    assert f["jk_no"] is None and f["tr_no"] is None
    f = api_item_to_race_result_fields({k: v for k, v in _item().items() if k not in ("jkNo", "trNo")})
    assert f["jk_no"] is None and f["tr_no"] is None
