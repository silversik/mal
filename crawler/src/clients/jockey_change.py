"""한국마사회 기수변경 (publicDataPk=15057181).

Endpoint: https://apis.data.go.kr/B551015/API10_1/jockeyChangeInfo_1

출주표 발표 이후 부상/사정 등으로 기수가 교체된 이벤트 로그.
일일 ~수십 건 (전국 평균). 같은 (rcDate, meet, rcNo, chulNo) 는 1건만.

응답 필드 (2026-04-23 실측):
    rcDate, meet (한글 "서울"/"제주"/"부경"), rcNo, chulNo,
    hrNo, hrName,
    jkBef, jkBefName, jkAft, jkAftName,
    befBudam, aftBudam, reason

⚠ `rc_date=YYYYMMDD` 가 동작 (snake_case). `rcDate` 는 무시되어 기본 응답(~32건) 반환.
⚠ meet 는 한글 그대로 — 1/2/3 코드 X (trainer/owner 와 동일 패턴).
⚠ 필터 없이 호출하면 최근 ~1개월 모든 이벤트 (numOfRows 기본 ~32) 가 반환.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API10_1"
DEFAULT_OPERATION = "jockeyChangeInfo_1"


class JockeyChangeClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_jockey_change, ENDPOINT)
        self.operation = operation

    def list_recent(self, *, page_size: int = 200) -> list[dict[str, Any]]:
        """필터 없이 최근 이벤트 (KRA 기본 응답 윈도우 ~1개월)."""
        return self.iter_items(self.operation, page_size=page_size)

    def list_by_date(self, rc_date: date, *, page_size: int = 100) -> list[dict[str, Any]]:
        """특정 날짜의 기수변경 이벤트.

        ⚠ KRA 가 받는 필터 키는 snake_case `rc_date=YYYYMMDD`.
        camelCase `rcDate` 는 무시되어 default window 가 돌아온다.
        """
        return self.iter_items(
            self.operation,
            page_size=page_size,
            rc_date=rc_date.strftime("%Y%m%d"),
        )


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


def _parse_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == "" or value == "-":
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _parse_decimal(value: Any) -> float | None:
    if value is None or value == "" or value == "-":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean(value: Any) -> Any:
    if value is None or value == "-" or value == "":
        return None
    return value


def _str(value: Any) -> str | None:
    v = _clean(value)
    if v is None:
        return None
    return str(v).strip() or None


def api_item_to_jockey_change_fields(item: dict[str, Any]) -> dict[str, Any]:
    """Map an API10_1/jockeyChangeInfo_1 item into `jockey_changes` columns."""
    return {
        "race_date": _parse_date(item.get("rcDate")),
        "meet": _str(item.get("meet")),
        "race_no": _parse_int(item.get("rcNo")),
        "chul_no": _parse_int(item.get("chulNo")),
        "horse_no": _str(item.get("hrNo")) or "",
        "horse_name": _str(item.get("hrName")),
        "jk_no_before": _str(item.get("jkBef")),
        "jk_name_before": _str(item.get("jkBefName")),
        "jk_no_after": _str(item.get("jkAft")),
        "jk_name_after": _str(item.get("jkAftName")),
        "weight_before": _parse_decimal(item.get("befBudam")),
        "weight_after": _parse_decimal(item.get("aftBudam")),
        "reason": _str(item.get("reason")),
        "raw": item,
    }
