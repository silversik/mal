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

    KRA API187 키 다중 폴백:
        date     rcDate / rcdate / rc_date
        meet     meet (1/2/3 → 한글)
        race_no  rcNo / rcno / rc_no
        name     rcName / rcNm / rcname / rcnm
        distance rcDist / rcdist / dist / rc_dist / distance
        grade    rank / rcRank / rcrank / gradeNm / gradenm / rcClass / rcclass / hrCls
        track    track / trkNm / trkname / trkType / trktype
        cond     trackCond / trkCond / trkcond / track_cond
        entries  chulCnt / chulcnt / entCnt / entcnt
        start    rcTime / stTime / sttime / rctime
    """
    meet_raw = str(item.get("meet") or "").strip()

    def first(*keys: str) -> Any:
        """대소문자/네이밍 차이 모두 시도. 첫 non-empty 값 반환."""
        for k in keys:
            v = item.get(k)
            if v is not None and str(v).strip() not in ("", "-"):
                return v
        return None

    return {
        "race_date": _parse_date_str(first("rcDate", "rcdate", "rc_date")),
        "meet": _MEET_NAMES.get(meet_raw, _clean(meet_raw)),
        "race_no": _parse_int(first("rcNo", "rcno", "rc_no")),
        "race_name": _clean(first("rcName", "rcNm", "rcname", "rcnm")),
        "distance": _parse_int(
            first("rcDist", "rcdist", "dist", "rc_dist", "distance"),
        ),
        "grade": _clean(
            first(
                "rank", "rcRank", "rcrank",
                "gradeNm", "gradenm",
                "rcClass", "rcclass",
                "hrCls", "hrcls",
            ),
        ),
        "track_type": _clean(
            first("track", "trkNm", "trkname", "trkType", "trktype"),
        ),
        "track_condition": _clean(
            first("trackCond", "trkCond", "trkcond", "track_cond"),
        ),
        "entry_count": _parse_int(first("chulCnt", "chulcnt", "entCnt", "entcnt")),
        "start_time": _clean(first("rcTime", "stTime", "sttime", "rctime")),
        "raw": item,
    }
