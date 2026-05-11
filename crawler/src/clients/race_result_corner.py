"""한국마사회 경주 구간별 성적 정보 (publicDataPk=15057847).

Endpoint: https://apis.data.go.kr/B551015/API6_1/raceDetailSectionRecord_1
Operation: raceDetailSectionRecord_1

기본 raceResult 와 달리 **경주 단위 1 row** (마필×경주 아님). 한 row 안에
그 경주의 통과 순위/시간/거리가 통째로:
  - passrank{S1F, G8F_1C, G6F_2C, G4F_3C, G3F_4C, G2F, G1F}  통과순위 (1등 누구였나)
  - time_1f ~ time_12f                                          구간기록
  - dist_1f ~ dist_10f                                          펄롱 통과거리
  - passtime_1f ~ passtime_10f                                  펄롱 통과시간

⚠ 마필별 통과순위는 안 들어옴. 1등마의 페이스 변화 (선행/추입) 만 추적 가능.

KRA 활용신청 publicDataPk=15057847. 미신청 시 500 반환.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API6_1"
DEFAULT_OPERATION = "raceDetailSectionRecord_1"


class RaceResultCornerClient(KraClient):
    """API6_1/raceDetailSectionRecord_1 — race-level 통과순위·구간기록."""

    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        # 활용신청 별도 키를 둘 수도 있지만 기본 race_result 키 폴백.
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


def _parse_decimal(value: Any) -> str | None:
    """구간기록 / passrank 모두 텍스트 그대로 보존. KRA 가 "-"/"" 외에
    "0" 정수로 미지원 표기하는 케이스도 있어 0/0.0 도 NULL 처리.
    """
    if value is None:
        return None
    s = str(value).strip()
    if s in ("", "-", "0", "0.0"):
        return None
    return s


_MEET_NAMES = {"1": "서울", "2": "제주", "3": "부경", "서울": "서울", "제주": "제주", "부경": "부경", "부산경남": "부경"}


def api_item_to_corner_fields(item: dict[str, Any]) -> dict[str, Any]:
    """API6_1 응답 1 row → race_corners 테이블 row.

    응답의 meet 가 한글 ("서울" 등) 으로 옴 — 그대로 사용.
    """
    meet_raw = str(item.get("meet") or "").strip()
    meet = _MEET_NAMES.get(meet_raw, meet_raw if meet_raw else None)

    race_date_raw = item.get("rcDate")
    race_no = _parse_int(item.get("rcNo"))
    if not (meet and race_date_raw and race_no is not None):
        return {"_skip": True, "raw": item}

    return {
        "race_date_raw": race_date_raw,    # YYYYMMDD string — caller 가 date 변환
        "meet": meet,
        "race_no": race_no,
        "rc_dist": _parse_int(item.get("rcDist")),

        # 통과순위 — KRA 표기 텍스트. 모든 마필의 그 시점 순위를 한 row 에 압축.
        # 예: "(^1,3,9)-7,2,6,(5,8),4" → 1=3=9 (선두) > 7 > 2 > 6 > 5=8 > 4
        "passrank_s1f":    _parse_decimal(item.get("passrankS1f")),
        "passrank_g8f_1c": _parse_decimal(item.get("passrankG8f_1c")),
        "passrank_g6f_2c": _parse_decimal(item.get("passrankG6f_2c")),
        "passrank_g4f_3c": _parse_decimal(item.get("passrankG4f_3c")),
        "passrank_g3f_4c": _parse_decimal(item.get("passrankG3f_4c")),
        "passrank_g2f":    _parse_decimal(item.get("passrankG2f")),
        "passrank_g1f":    _parse_decimal(item.get("passrankG1f")),

        # 펄롱별 구간 기록 (1F ~ 12F 누적 또는 분할)
        "time_1f":  _parse_decimal(item.get("time_1f")),
        "time_2f":  _parse_decimal(item.get("time_2f")),
        "time_3f":  _parse_decimal(item.get("time_3f")),
        "time_4f":  _parse_decimal(item.get("time_4f")),
        "time_5f":  _parse_decimal(item.get("time_5f")),
        "time_6f":  _parse_decimal(item.get("time_6f")),
        "time_7f":  _parse_decimal(item.get("time_7f")),
        "time_8f":  _parse_decimal(item.get("time_8f")),
        "time_9f":  _parse_decimal(item.get("time_9f")),
        "time_10f": _parse_decimal(item.get("time_10f")),
        "time_11f": _parse_decimal(item.get("time_11f")),
        "time_12f": _parse_decimal(item.get("time_12f")),

        # 펄롱별 통과 거리 (1F~10F 누적거리)
        "dist_1f":  _parse_int(item.get("dist_1f")),
        "dist_2f":  _parse_int(item.get("dist_2f")),
        "dist_3f":  _parse_int(item.get("dist_3f")),
        "dist_4f":  _parse_int(item.get("dist_4f")),
        "dist_5f":  _parse_int(item.get("dist_5f")),
        "dist_6f":  _parse_int(item.get("dist_6f")),
        "dist_7f":  _parse_int(item.get("dist_7f")),
        "dist_8f":  _parse_int(item.get("dist_8f")),
        "dist_9f":  _parse_int(item.get("dist_9f")),
        "dist_10f": _parse_int(item.get("dist_10f")),

        # 펄롱별 통과 시간
        "passtime_1f":  _parse_decimal(item.get("passtime_1f")),
        "passtime_2f":  _parse_decimal(item.get("passtime_2f")),
        "passtime_3f":  _parse_decimal(item.get("passtime_3f")),
        "passtime_4f":  _parse_decimal(item.get("passtime_4f")),
        "passtime_5f":  _parse_decimal(item.get("passtime_5f")),
        "passtime_6f":  _parse_decimal(item.get("passtime_6f")),
        "passtime_7f":  _parse_decimal(item.get("passtime_7f")),
        "passtime_8f":  _parse_decimal(item.get("passtime_8f")),
        "passtime_9f":  _parse_decimal(item.get("passtime_9f")),
        "passtime_10f": _parse_decimal(item.get("passtime_10f")),

        "raw": item,
    }
