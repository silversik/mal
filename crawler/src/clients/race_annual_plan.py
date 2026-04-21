"""한국마사회 대상경주 연간계획 (publicDataPk=15059482).

Endpoint: https://apis.data.go.kr/B551015/API40/raceAnnualPlan

연초에 확정되는 GI/GII/GIII 등 대상(스테이크) 경주 달력을 meet · year 단위로
받아온다. 주기: 하루 1회면 충분(연간 계획은 거의 바뀌지 않음, 간혹 일정 조정).

⚠ 활용신청 필수 — data.go.kr 15059482.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API40"
DEFAULT_OPERATION = "raceAnnualPlan"


class RaceAnnualPlanClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        # race_info 와 같은 service key 계열을 사용 (필요하면 별도 키로 분리 가능)
        super().__init__(settings.kra_key_race_info, ENDPOINT)
        self.operation = operation

    def list_by_year(
        self,
        year: int,
        *,
        meet: int | None = None,
        page_size: int = 200,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"rc_year": year}
        if meet is not None:
            params["meet"] = meet
        return self.iter_items(self.operation, page_size=page_size, **params)


# --------------------------------------------------------------------- mapping

_MEET_NAMES = {"1": "서울", "2": "제주", "3": "부경"}


def _parse_date(value: Any) -> date | None:
    if value is None:
        return None
    s = str(value).strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_big_int(value: Any) -> int | None:
    """상금은 '1,000,000' 같은 콤마 포함 문자열일 수 있다."""
    if value is None:
        return None
    s = str(value).replace(",", "").replace("원", "").strip()
    try:
        return int(s)
    except ValueError:
        return None


def _clean(value: Any) -> Any:
    if value is None or value in ("-", "", "미정"):
        return None
    return value


def api_item_to_race_plan_fields(item: dict[str, Any], *, year: int) -> dict[str, Any]:
    """Map a raceAnnualPlan item into `race_plans` columns.

    KRA 필드명이 Swagger 확인 전이므로 가장 일반적인 후보들을 모두 시도.
    """
    meet_raw = str(item.get("meet") or "").strip()
    return {
        "meet": _MEET_NAMES.get(meet_raw, _clean(meet_raw) or "알수없음"),
        "year": _parse_int(item.get("rc_year")) or year,
        "race_date": _parse_date(
            item.get("rc_date") or item.get("rcDate") or item.get("raceDate")
        ),
        "race_no": _parse_int(item.get("rc_no") or item.get("rcNo")),
        "race_name": str(
            item.get("rc_name") or item.get("rcName") or item.get("raceName") or ""
        ).strip(),
        "grade": _clean(item.get("grade") or item.get("rcGrade") or item.get("raceGrade")),
        "distance": _parse_int(item.get("rc_dist") or item.get("rcDist") or item.get("distance")),
        "track_type": _clean(item.get("track") or item.get("trackType")),
        "age_cond": _clean(item.get("age_cond") or item.get("ageCond")),
        "prize_1st": _parse_big_int(item.get("pr1st") or item.get("prize1st")),
        "total_prize": _parse_big_int(item.get("prTot") or item.get("prizeTotal")),
        "raw": item,
    }
