"""한국마사회 경주별상세성적표_2 (publicDataPk=15089493).

Endpoint: https://apis.data.go.kr/B551015/API4_2/raceResult_2
Operation: raceResult_2

기본 raceResult 와 같은 row 단위(=마필×경주)이지만 통과순위·구간기록을
포함. mal.kr 의 페이스 맵(B-1)이 의존.

Verified field name candidates (KRA 응답 변형이 잦으니 다중 폴백):
    hrNo / hrno    마번
    hrName / hrname 마명
    rcDate / rcdate 경주일자
    meet            경마장 (1/2/3)
    rcNo / rcno    경주번호
    ord1cOrd        1코너 통과순위
    ord2cOrd        2코너 통과순위
    ord3cOrd        3코너 통과순위
    ord4cOrd        4코너 통과순위
    g1fOrd / g3fOrd 결승 1/3펄롱 통과순위
    s1fOrd          출발 후 1펄롱 통과순위
    ratingChullopt  핸디캡 / 부담중량
    prizeMoney      상금

⚠ 활용신청 필수 — racedetailresult 와 별도 신청.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API4_2"
DEFAULT_OPERATION = "raceResult_2"


class RaceResultCornerClient(KraClient):
    """API4_2/raceResult_2 — 마필별 통과순위 포함 경주 결과."""

    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        # KRA 가 race_result 와 동일 키를 활용신청에 묶을 수도 있어 폴백.
        key = (
            getattr(settings, "kra_key_race_result_corner", None)
            or settings.kra_key_race_result
        )
        super().__init__(key, ENDPOINT)
        self.operation = operation

    def list_by_date(
        self, rc_date: date, meet: int, *, page_size: int = 200
    ) -> list[dict[str, Any]]:
        return self.iter_items(
            self.operation,
            page_size=page_size,
            meet=meet,
            rc_date=rc_date.strftime("%Y%m%d"),
        )


# --------------------------------------------------------------------- mapping


def _first(item: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        v = item.get(k)
        if v is not None and str(v).strip() not in ("", "-"):
            return v
    return None


def _parse_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def api_item_to_corner_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map an API4_2 item into a row for the future race_result_corners table.

    반환 dict 의 ord1c~ord4c 는 코너 통과순위, g1f/g3f/s1f 는 펄롱 통과순위.
    NULL 인 값은 KRA 가 안 보낸 것 — 모두 nullable 로 둘 것.
    """
    return {
        "horse_no": str(_first(item, "hrNo", "hrno") or "").strip() or None,
        "race_date": _first(item, "rcDate", "rcdate"),
        "meet_raw":  _first(item, "meet"),
        "race_no":   _parse_int(_first(item, "rcNo", "rcno")),
        "ord_1c":    _parse_int(_first(item, "ord1cOrd", "ord1corner", "ord1c")),
        "ord_2c":    _parse_int(_first(item, "ord2cOrd", "ord2corner", "ord2c")),
        "ord_3c":    _parse_int(_first(item, "ord3cOrd", "ord3corner", "ord3c")),
        "ord_4c":    _parse_int(_first(item, "ord4cOrd", "ord4corner", "ord4c")),
        "ord_g1f":   _parse_int(_first(item, "g1fOrd", "g1ford")),
        "ord_g3f":   _parse_int(_first(item, "g3fOrd", "g3ford")),
        "ord_s1f":   _parse_int(_first(item, "s1fOrd", "s1ford")),
        "raw":       item,
    }
