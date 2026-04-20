"""한국마사회 경마경주정보 (publicDataPk=15063951).

Endpoint: https://apis.data.go.kr/B551015/API187/HorseRaceInfo

Race-level metadata: each row is one race (not one horse in a race).
Provides distance, grade, track type, race name, etc.

Typical query: meet + ym_fr + ym_to (year range) → returns all races.

⚠ 활용신청 필수.
"""
from __future__ import annotations

from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API187"
DEFAULT_OPERATION = "HorseRaceInfo"


class RaceInfoClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_race_info, ENDPOINT)
        self.operation = operation

    def list_by_year(
        self,
        year: int,
        *,
        meet: int | None = None,
        page_size: int = 500,
        max_pages: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "ym_fr": year,
            "ym_to": year,
        }
        if meet is not None:
            params["meet"] = meet
        return self.iter_items(
            self.operation, page_size=page_size, max_pages=max_pages, **params
        )


# --------------------------------------------------------------------- mapping

_MEET_NAMES = {"1": "서울", "2": "제주", "3": "부경"}


def _parse_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _clean(value: Any) -> Any:
    if value is None or value == "-" or value == "":
        return None
    return value


def _parse_date_str(value: Any) -> str | None:
    """Return YYYY-MM-DD string or None."""
    if value is None:
        return None
    s = str(value).strip()
    if s == "-" or s == "" or len(s) < 8:
        return None
    if len(s) == 8:
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return s


def api_item_to_race_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map a HorseRaceInfo item into `races` columns.

    Expected field names (verify after activation):
        rcDate      경주일자
        meet        경마장
        rcNo        경주번호
        rcName      경주명
        rcDist      거리(m)
        rank        등급
        track       주로 타입 (잔디/모래)
        trackCond   주로 상태
        chulCnt     출전두수
        rcTime      발주 시각 (HH:MM) — race_results 의 rcTime(기록)과 별개
    """
    meet_raw = str(item.get("meet") or "").strip()
    return {
        "race_date": _parse_date_str(item.get("rcDate")),
        "meet": _MEET_NAMES.get(meet_raw, _clean(meet_raw)),
        "race_no": _parse_int(item.get("rcNo")),
        "race_name": _clean(item.get("rcName") or item.get("rcNm")),
        "distance": _parse_int(item.get("rcDist") or item.get("dist")),
        "grade": _clean(item.get("rank") or item.get("gradeNm") or item.get("rcClass")),
        "track_type": _clean(item.get("track") or item.get("trkNm")),
        "track_condition": _clean(item.get("trackCond") or item.get("trkCond")),
        "entry_count": _parse_int(item.get("chulCnt") or item.get("entCnt")),
        "start_time": _clean(item.get("rcTime") or item.get("stTime")),
        "raw": item,
    }
