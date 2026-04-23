"""한국마사회 마필종합 상세정보 (API42_1).

Endpoint: https://apis.data.go.kr/B551015/API42_1/totalHorseInfo_1

Verified against data.go.kr (publicDataPk=15057985). Returns ~218 fields per
horse — we map the subset we care about and stash the full payload in `raw`
JSONB so future schema additions do not require re-fetching.

Query parameters:
    hr_name      — 마명 (옵션, 부분 일치)
    hr_no        — 마필고유번호 (옵션, 단건 조회)
    hr_eng_name  — 영문 마명 (옵션)
    pageNo, numOfRows  — 페이징 (필수)

비고: hr_name/hr_no/hr_eng_name 모두 비우면 임의 100건만 반환됩니다.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from ..logging import get_logger
from .kra_base import KraClient

log = get_logger(__name__)

ENDPOINT = "API42_1"
DEFAULT_OPERATION = "totalHorseInfo_1"


class HorseDetailClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_horse_detail, ENDPOINT)
        self.operation = operation

    def search_by_name(self, horse_name: str, *, limit: int = 100) -> list[dict[str, Any]]:
        return self.iter_items(
            self.operation, page_size=limit, max_pages=1, hr_name=horse_name
        )

    def get_by_no(self, horse_no: str) -> dict[str, Any] | None:
        items = self.iter_items(
            self.operation, page_size=10, max_pages=1, hr_no=horse_no
        )
        return items[0] if items else None

    def sample(self, n: int = 10) -> list[dict[str, Any]]:
        """Return ``n`` arbitrary horses (API returns a random page when no
        identifier filter is supplied). Useful for smoke tests / seeding."""
        return self.iter_items(self.operation, page_size=n, max_pages=1)


# --------------------------------------------------------------------- mapping


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    value = str(value).strip()
    for fmt in ("%Y%m%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _parse_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean(value: Any) -> Any:
    """KRA API uses '-' as a placeholder for empty strings. Normalize to None."""
    if value is None or value == "-" or value == "":
        return None
    return value


_COAT_ALIASES = {
    "갈": "갈색",
    "밤": "밤색",
    "회": "회색",
    "흑": "흑색",
    "백": "백색",
    "청": "청색",
    "흑갈": "흑갈색",
    "적갈": "적갈색",
    "월": "월모",
}


def _normalize_coat(value: Any) -> str | None:
    """KRA 응답의 `color` 값은 '갈' / '갈색' 혼용 → 한 형태로 정규화."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s == "-":
        return None
    if s in _COAT_ALIASES:
        return _COAT_ALIASES[s]
    return s


def _collect_chars(item: dict[str, Any]) -> list[str]:
    """char1..char4 각 셀은 쉼표로 여러 특징이 붙을 수 있음 → 개별 토큰으로 분리."""
    tokens: list[str] = []
    for k in ("char1", "char2", "char3", "char4"):
        val = _clean(item.get(k))
        if not val:
            continue
        for t in str(val).split(","):
            t = t.strip()
            if t and t != "-":
                tokens.append(t)
    return tokens


def _parent_no(value: Any) -> str | None:
    """fhrNo/mhrNo 정규화. KRA 는 number/string 혼재 + "-"/"0"/빈문자 placeholder."""
    if value is None:
        return None
    s = str(value).strip()
    if s in ("", "-", "0"):
        return None
    return s


def api_item_to_horse_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map a raw API42_1/totalHorseInfo_1 item into `horses` table columns.

    Verified field names (218 total in the response):
        hrNo     마필고유번호
        hrNm     마명
        sanji    산지
        sex      성별 (수/암/거)
        birthDt  생년월일 (YYYYMMDD)
        fhrNm    부마명 (Father horse name)
        fhrNo    부마번호 — 혈통 트리에서 ID 기반 join 에 사용 (migration 019)
        mhrNm    모마명 (Mother horse name)
        mhrNo    모마번호
        rcCnt    통산출전횟수
        fstCnt   통산 1착 횟수
        color    모색 (갈색/밤색/흑색/회색/백색/청색)
        char1..4 특징 (이마가마상, 유성, 좌앞다리가마, 목줄가마 …)
    """
    return {
        "horse_no": str(item.get("hrNo") or "").strip(),
        "horse_name": str(item.get("hrNm") or "").strip(),
        "country": _clean(item.get("sanji")),
        "sex": _clean(item.get("sex")),
        "birth_date": _parse_date(item.get("birthDt")),
        "sire_name": _clean(item.get("fhrNm")),
        "sire_no": _parent_no(item.get("fhrNo")),
        "dam_name": _clean(item.get("mhrNm")),
        "dam_no": _parent_no(item.get("mhrNo")),
        "total_race_count": _parse_int(item.get("rcCnt")),
        "first_place_count": _parse_int(item.get("fstCnt")),
        "coat_color": _normalize_coat(item.get("color")),
        "characteristics": _collect_chars(item),
        "raw": item,
    }
