"""한국마사회 매출액·배당률 (publicDataPk=15119558).

Endpoint: https://apis.data.go.kr/B551015/API179_1/salesAndDividendRate_1

응답 필드 (2026-04-23 실측):
    rcDate (YYYYMMDD), meet (1/2/3), rcNo, pool (한글), amt, odds (텍스트)

⚠ 응답 1행 = (rcDate, meet, rcNo, pool) 의 매출액 + 인기순위 odds 텍스트 모음.
   한 경주는 최대 7개 row (단식/연식/쌍식/복식/복연/삼복/삼쌍 풀 모두).
⚠ 필터 키는 snake_case `rc_date`, `rc_no` (camelCase rcDate/rcNo 는 무시).
⚠ meet 은 숫자 (1/2/3) — 한글 정규화는 mapping 함수에서 수행.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API179_1"
DEFAULT_OPERATION = "salesAndDividendRate_1"

# 응답 meet (1/2/3) → 다른 테이블과 일치시키기 위한 한글 매핑.
_MEET_NAMES = {1: "서울", 2: "제주", 3: "부경", "1": "서울", "2": "제주", "3": "부경"}


class RaceSalesClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_race_sales, ENDPOINT)
        self.operation = operation

    def list_by_date(
        self,
        rc_date: date,
        *,
        meet: int | None = None,
        page_size: int = 200,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"rc_date": rc_date.strftime("%Y%m%d")}
        if meet is not None:
            params["meet"] = meet
        return self.iter_items(self.operation, page_size=page_size, **params)

    def list_recent(self, *, page_size: int = 200) -> list[dict[str, Any]]:
        """필터 없이 KRA 기본 응답 (totalCount 가 1500+ 이라 페이지네이션)."""
        return self.iter_items(self.operation, page_size=page_size)


# --------------------------------------------------------------------- mapping


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    s = str(value).strip()
    if s in {"", "-"}:
        return None
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == "" or value == "-":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _str(value: Any) -> str | None:
    if value is None or value == "" or value == "-":
        return None
    return str(value).strip() or None


def _meet_to_name(value: Any) -> str | None:
    """KRA meet 숫자(1/2/3) → 한글. 이미 한글이면 그대로."""
    if value is None or value == "":
        return None
    if value in _MEET_NAMES:
        return _MEET_NAMES[value]
    s = str(value).strip()
    if s in _MEET_NAMES:
        return _MEET_NAMES[s]
    # 한글 그대로 들어왔다면 정규화 없이 사용 (방어적).
    return s or None


def api_item_to_race_sales_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map an API179_1/salesAndDividendRate_1 item into `race_pool_sales` columns."""
    return {
        "race_date": _parse_date(item.get("rcDate")),
        "meet": _meet_to_name(item.get("meet")),
        "race_no": _parse_int(item.get("rcNo")),
        "pool": _str(item.get("pool")),
        "amount": _parse_int(item.get("amt"), default=0) or 0,
        "odds_summary": _str(item.get("odds")),
        "raw": item,
    }
