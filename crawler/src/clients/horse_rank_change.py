"""한국마사회 경주마 등급변동 정보 (publicDataPk=15058076).

Endpoint: https://apis.data.go.kr/B551015/raceHorseRatingChangeInfo_2/raceHorseRatingChangeInfo_2
                                          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                          endpoint 그룹                  operation
KRA 가 endpoint family 와 operation 이름을 동일하게 쓰는 비표준 케이스 — API#### prefix 가 없다.

응답 필드 (2026-04-23 실측):
    stDate (적용일, YYYYMMDD), spDate (시행일, 대부분 "-"),
    meet (한글 "서울"/"제주"/"부경"), hrNo, hrName, blood,
    beforeRank (예 "국6"), rank (변경 후, 예 "국5")

⚠ totalCount 가 ~5000 으로 누적 — 한 번에 전체 페이지 순회하면 50회 호출.
   필터 키 미공개 — 그냥 전체 페이지 적재 후 idempotent UPSERT.
⚠ "rating" 이 아닌 KRA "등급" (국1~국6 등) 라벨. B1 horse_ratings (numeric) 와는 별개.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "raceHorseRatingChangeInfo_2"
DEFAULT_OPERATION = "raceHorseRatingChangeInfo_2"


class HorseRankChangeClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_horse_rank_change, ENDPOINT)
        self.operation = operation

    def list_all(self, *, page_size: int = 200) -> list[dict[str, Any]]:
        """전체 페이지 순회 (~5000 row, 약 25 page)."""
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


def _str(value: Any) -> str | None:
    if value is None or value == "" or value == "-":
        return None
    return str(value).strip() or None


def api_item_to_horse_rank_change_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map a raceHorseRatingChangeInfo_2 item into `horse_rank_changes` columns."""
    return {
        "horse_no": _str(item.get("hrNo")) or "",
        "st_date": _parse_date(item.get("stDate")),
        "horse_name": _str(item.get("hrName")),
        "meet": _str(item.get("meet")),
        "blood": _str(item.get("blood")),
        "before_rank": _str(item.get("beforeRank")),
        "after_rank": _str(item.get("rank")),
        "sp_date": _parse_date(item.get("spDate")),
        "raw": item,
    }
