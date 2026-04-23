"""한국마사회 조교사정보_영문추가 (publicDataPk=15130588).

Endpoint: https://apis.data.go.kr/B551015/API308/trainerInfo

응답 필드 (2026-04-23 실측):
    trNo, trName, trNameEn, meet, meetEn, stDate (데뷔), spDate,
    rcCntT/Y, ord1CntT/Y, ord2CntT/Y, ord3CntT/Y,
    winRateT/Y, plcRateT/Y, qnlRateT/Y, part

⚠ 응답에 birthday 가 없음 — trainers.birth_date 는 항상 NULL.
⚠ meet 는 "서울"/"제주"/"부산경남" 한글 그대로 옴 (1/2/3 코드 X).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API308"
DEFAULT_OPERATION = "trainerInfo"


class TrainerClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_trainer, ENDPOINT)
        self.operation = operation

    def list_all(self, *, meet: int | None = None, page_size: int = 200) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if meet is not None:
            params["meet"] = meet
        return self.iter_items(self.operation, page_size=page_size, **params)

    def search_by_name(self, tr_name: str) -> list[dict[str, Any]]:
        return self.iter_items(
            self.operation, page_size=100, max_pages=1, tr_name=tr_name
        )


# --------------------------------------------------------------------- mapping

_MEET_NAMES = {"1": "서울", "2": "제주", "3": "부경"}


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    s = str(value).strip()
    if s == "-" or s == "":
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean(value: Any) -> Any:
    if value is None or value == "-" or value == "":
        return None
    return value


def _first(item: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        v = item.get(k)
        if v is not None and v != "" and v != "-":
            return v
    return None


def api_item_to_trainer_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map an API308/trainerInfo item into `trainers` columns."""
    total = _parse_int(_first(item, "rcCntT", "rcCnt"))
    first = _parse_int(_first(item, "ord1CntT", "ord1Cnt"))
    # API 가 winRateT 직접 제공 — 없으면 first/total 로 계산.
    win_rate_api = _first(item, "winRateT")
    if win_rate_api is not None:
        try:
            win_rate = float(win_rate_api)
        except (TypeError, ValueError):
            win_rate = round(first / total * 100, 2) if total > 0 else None
    else:
        win_rate = round(first / total * 100, 2) if total > 0 else None
    return {
        "tr_no": str(_first(item, "trNo", "tr_no") or "").strip(),
        "tr_name": str(_first(item, "trName", "trNm", "tr_name") or "").strip(),
        "tr_name_en": _clean(_first(item, "trNameEn", "trEnName", "trEnNm")),
        "meet": _clean(item.get("meet")),  # 응답이 이미 한글 ("서울"/"제주"/"부산경남")
        "birth_date": None,  # API 미제공
        "debut_date": _parse_date(_first(item, "stDate", "debut", "debutDt")),
        "total_race_count": total,
        "first_place_count": first,
        "second_place_count": _parse_int(_first(item, "ord2CntT", "ord2Cnt")),
        "third_place_count": _parse_int(_first(item, "ord3CntT", "ord3Cnt")),
        "win_rate": win_rate,
        "raw": item,
    }
