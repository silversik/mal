"""한국마사회 경주마 레이팅 정보 (publicDataPk=15057323).

Endpoint: https://apis.data.go.kr/B551015/API77/raceHorseRating

응답 분석 (2026-04-23 실측):
    row 단위가 (마필) — 한 마필당 1 row, rating1~rating4 컬럼.
    응답에 *공시일자가 없음* — 시계열 비교 불가, 항상 "최신 스냅샷" 의미.
    필드: hrNo, hrName, meet, rating1, rating2, rating3, rating4

⚠ rating1~rating4 의 정확한 의미는 KRA 문서 미공개. 가설:
   - 등급별/연령별 카테고리 (3세, 4세이상, 혼합 등) 또는
   - 시간 인덱스 (1=가장 오래, 4=최신) — 같은 row 안에서 rating1 ≤ rating4 경향.
   raw JSONB 로 보존하므로 의미 확인 후 SQL 만으로 재해석 가능.
"""
from __future__ import annotations

from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API77"
DEFAULT_OPERATION = "raceHorseRating"


class HorseRatingClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_horse_rating, ENDPOINT)
        self.operation = operation

    def list_all(self, *, meet: int | None = None, page_size: int = 200) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if meet is not None:
            params["meet"] = meet
        return self.iter_items(self.operation, page_size=page_size, **params)

    def search_by_horse(self, hr_no: str) -> list[dict[str, Any]]:
        return self.iter_items(
            self.operation, page_size=100, max_pages=1, hr_no=hr_no
        )


# --------------------------------------------------------------------- mapping


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    s = str(value).strip()
    if s == "" or s == "-":
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _clean_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if s == "" or s == "-":
        return None
    return s


def api_item_to_rating_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map API77/raceHorseRating row → `horse_ratings` columns."""
    horse_no = _clean_str(item.get("hrNo"))
    if not horse_no:
        return {}
    return {
        "horse_no": horse_no,
        "horse_name": _clean_str(item.get("hrName")),
        "meet": _clean_str(item.get("meet")),
        "rating1": _parse_int(item.get("rating1")),
        "rating2": _parse_int(item.get("rating2")),
        "rating3": _parse_int(item.get("rating3")),
        "rating4": _parse_int(item.get("rating4")),
        "raw": item,
    }
