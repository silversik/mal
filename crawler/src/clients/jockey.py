"""한국마사회 현직기수정보 (publicDataPk=15086329).

Endpoint: https://apis.data.go.kr/B551015/currentjockeyInfo/getcurrentjockeyinfo

Provides profile + career stats for active jockeys at all 3 racetracks.
Field names below are best-guess based on KRA naming conventions —
verify and adjust after activation.

⚠ 활용신청 필수.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "currentjockeyInfo"
DEFAULT_OPERATION = "getcurrentjockeyinfo"


class JockeyClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_jockey, ENDPOINT)
        self.operation = operation

    def list_all(self, *, meet: int | None = None, page_size: int = 200) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if meet is not None:
            params["meet"] = meet
        return self.iter_items(self.operation, page_size=page_size, **params)

    def search_by_name(self, jk_name: str) -> list[dict[str, Any]]:
        return self.iter_items(
            self.operation, page_size=100, max_pages=1, jk_name=jk_name
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


def _parse_number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean(value: Any) -> Any:
    if value is None or value == "-" or value == "":
        return None
    return value


def api_item_to_jockey_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map a currentjockeyinfo item into `jockeys` columns.

    Verified field names (2026-04-15):
        jkNo        기수번호
        jkName      기수명
        meet        소속 ("서울"/"제주"/"부경" — 텍스트)
        birthday    생년월일 (마스킹됨 "********")
        debut       데뷔일 (YYYYMMDD)
        rcCntT      통산출전
        ord1CntT    통산 1착
        ord2CntT    통산 2착
        ord3CntT    통산 3착
    """
    meet_raw = str(item.get("meet") or "").strip()
    total = _parse_int(item.get("rcCntT"))
    first = _parse_int(item.get("ord1CntT"))
    win_rate = round(first / total * 100, 2) if total > 0 else None
    return {
        "jk_no": str(item.get("jkNo") or "").strip(),
        "jk_name": str(item.get("jkName") or "").strip(),
        "meet": _MEET_NAMES.get(meet_raw, _clean(meet_raw)),
        "birth_date": _parse_date(item.get("birthday")),
        "debut_date": _parse_date(item.get("debut")),
        "total_race_count": total,
        "first_place_count": first,
        "second_place_count": _parse_int(item.get("ord2CntT")),
        "third_place_count": _parse_int(item.get("ord3CntT")),
        "win_rate": win_rate,
        "raw": item,
    }
