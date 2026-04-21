"""한국마사회 출전표 상세정보 (publicDataPk=15058677).

Endpoint: https://apis.data.go.kr/B551015/API26_2/<operation>

Swagger 접근 전에는 정확한 operation 이름을 확정할 수 없어, 기본값을 두되
`KRA_CHULMA_OPERATION` env var 로 덮어쓸 수 있게 해둔다. KRA 활용신청 승인 후
data.go.kr Swagger UI 에서 확인해 .env 에 박아두면 된다 (예: `chulMaDetailInfo_2`).

호출 패턴: 경주월(rc_month) + 경주일(rc_date) + meet 으로 해당 일자 모든
경주의 출전마 리스트를 받아 race_entries 에 UPSERT.

⚠ 활용신청 필수 — data.go.kr 15058677.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API26_2"


class RaceChulmaClient(KraClient):
    def __init__(self, operation: str | None = None) -> None:
        op = operation or settings.kra_chulma_operation
        if not op:
            raise RuntimeError(
                "KRA_CHULMA_OPERATION 이 비어 있습니다. data.go.kr Swagger 에서 "
                "API26_2 의 operation 이름(예: chulMaDetailInfo_2)을 확인 후 .env 에 설정하세요."
            )
        super().__init__(settings.kra_key_race_info, ENDPOINT)
        self.operation = op

    def list_by_date(
        self,
        rc_date: date,
        meet: int,
        *,
        page_size: int = 200,
    ) -> list[dict[str, Any]]:
        """특정 경마장의 특정 일자 모든 경주 출전마 리스트."""
        return self.iter_items(
            self.operation,
            page_size=page_size,
            meet=meet,
            rc_date=rc_date.strftime("%Y%m%d"),
            rc_month=rc_date.strftime("%Y%m"),
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
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean(value: Any) -> Any:
    if value is None or value in ("-", ""):
        return None
    return value


def api_item_to_race_entry_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map a chulma item into `race_entries` columns.

    필드명은 다른 KRA API 와의 일관성으로 추정 — 최종 확인 전까지 여러 후보 시도.
    """
    meet_raw = str(item.get("meet") or "").strip()
    return {
        "race_date": _parse_date(item.get("rcDate") or item.get("rc_date")),
        "meet": _MEET_NAMES.get(meet_raw, _clean(meet_raw) or "알수없음"),
        "race_no": _parse_int(item.get("rcNo") or item.get("rc_no")),
        "horse_no": str(item.get("hrNo") or "").strip(),
        "chul_no": _parse_int(item.get("chulNo") or item.get("chul_no")),
        "horse_name": _clean(item.get("hrName") or item.get("hrNm")),
        "jk_no": _clean(item.get("jkNo")),
        "jockey_name": _clean(item.get("jkName")),
        "trainer_name": _clean(item.get("trName") or item.get("trainerName")),
        "weight": _parse_number(item.get("wgHr") or item.get("weight")),
        "age": _clean(item.get("age")),
        "sex": _clean(item.get("sex")),
        "rating": _parse_int(item.get("hrRating") or item.get("rating")),
        "raw": item,
    }
