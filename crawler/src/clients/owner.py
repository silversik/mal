"""한국마사회 마주정보_영문추가 (publicDataPk=15130589).

Endpoint: https://apis.data.go.kr/B551015/API309/horseOwnerInfo

응답 필드 (예상 — API308/trainerInfo 와 평행 구조):
    owNo, owName, owNameEn, meet, meetEn,
    rcCntT/Y, ord1CntT/Y, ord2CntT/Y, ord3CntT/Y,
    winRateT/Y, plcRateT/Y, qnlRateT/Y, part

⚠ meet 는 "서울"/"제주"/"부산경남" 한글 그대로 (1/2/3 코드 X) — trainer 와 동일.
⚠ 마주는 개인+법인 혼재 — owName 에 회사명/한자 등 다양한 형식.
⚠ 등록일(stDate)/생년월일은 응답에 없을 수 있음 — None 처리.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API309"
DEFAULT_OPERATION = "horseOwnerInfo"


class OwnerClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_owner, ENDPOINT)
        self.operation = operation

    def list_all(self, *, meet: int | None = None, page_size: int = 200) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if meet is not None:
            params["meet"] = meet
        return self.iter_items(self.operation, page_size=page_size, **params)

    def search_by_name(self, ow_name: str) -> list[dict[str, Any]]:
        return self.iter_items(
            self.operation, page_size=100, max_pages=1, ow_name=ow_name
        )


# --------------------------------------------------------------------- mapping


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


def api_item_to_owner_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map an API309/horseOwnerInfo item into `owners` columns."""
    total = _parse_int(_first(item, "rcCntT", "rcCnt"))
    first = _parse_int(_first(item, "ord1CntT", "ord1Cnt"))
    win_rate_api = _first(item, "winRateT")
    if win_rate_api is not None:
        try:
            win_rate = float(win_rate_api)
        except (TypeError, ValueError):
            win_rate = round(first / total * 100, 2) if total > 0 else None
    else:
        win_rate = round(first / total * 100, 2) if total > 0 else None
    return {
        "ow_no": str(_first(item, "owNo", "ow_no") or "").strip(),
        "ow_name": str(_first(item, "owName", "owNm", "ow_name") or "").strip(),
        "ow_name_en": _clean(_first(item, "owNameEn", "owEnName", "owEnNm")),
        "meet": _clean(item.get("meet")),  # 응답이 한글 ("서울"/"제주"/"부산경남")
        "reg_date": _parse_date(_first(item, "stDate", "regDate", "regDt")),
        "total_race_count": total,
        "first_place_count": first,
        "second_place_count": _parse_int(_first(item, "ord2CntT", "ord2Cnt")),
        "third_place_count": _parse_int(_first(item, "ord3CntT", "ord3Cnt")),
        "win_rate": win_rate,
        "raw": item,
    }
