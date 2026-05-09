"""한국마사회 경주별상세성적표 (publicDataPk=15089492).

Endpoint: https://apis.data.go.kr/B551015/racedetailresult/getracedetailresult

Verified field names (per data.go.kr docs):
    hrNo     마번
    hrName   마명
    rcDate   경주일자 (YYYYMMDD)
    meet     경마장 (1=서울, 2=제주, 3=부경)
    rcNo     경주번호
    track    주로상태 (건조/양호/다습/포장/불량)
    stOrd    확정착순 (rank)
    rcTime   경주기록(초)
    wgHr     마체중(kg)
    jkName   기수명
    trName   조교사명

호출 패턴: meet + rc_date 조합으로 특정 경마장의 그 날 모든 경주 결과를 가져옴.
하루치를 한 번에 받고 jobs/sync_races.py 가 horse_no 단위로 분해해서 UPSERT.

⚠ 활용신청 필수 — 이 endpoint는 마필종합 상세정보(API42_1)와 별도로 신청해야 합니다.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "racedetailresult"
DEFAULT_OPERATION = "getracedetailresult"


class RaceResultClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_race_result, ENDPOINT)
        self.operation = operation

    def list_by_date(
        self, rc_date: date, meet: int, *, page_size: int = 200
    ) -> list[dict[str, Any]]:
        """Fetch all race results for a single (meet, date) combination."""
        return self.iter_items(
            self.operation,
            page_size=page_size,
            meet=meet,
            rc_date=rc_date.strftime("%Y%m%d"),
        )


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


def _parse_number(value: Any) -> float | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s == "-":
        return None
    # KRA rcTime 은 "1:22.4" (M:SS.f) 형식. 단순 float() 파싱은 실패해 record_time 이
    # 통째로 NULL 로 적재되던 사고가 있었음. 분 부분이 있으면 초 단위로 환산.
    if ":" in s:
        try:
            mins, secs = s.split(":", 1)
            return int(mins) * 60 + float(secs)
        except (TypeError, ValueError):
            return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _clean(value: Any) -> Any:
    if value is None or value == "-" or value == "":
        return None
    return value


def api_item_to_race_result_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map a getracedetailresult item into `race_results` columns."""
    meet_raw = str(item.get("meet") or "").strip()
    return {
        "horse_no": str(item.get("hrNo") or "").strip(),
        "race_date": _parse_date(item.get("rcDate")),
        "meet": _MEET_NAMES.get(meet_raw, _clean(meet_raw)),
        "race_no": _parse_int(item.get("rcNo")),
        "track_condition": _clean(item.get("track")),
        "rank": _parse_int(item.get("stOrd") or item.get("ord")),
        "record_time": _parse_number(item.get("rcTime")),
        "weight": _parse_number(item.get("wgHr")),
        "jockey_name": _clean(item.get("jkName")),
        "trainer_name": _clean(item.get("trName")),
        "raw": item,
    }
