"""한국마사회 경마시행당일_확정배당율종합 (publicDataPk=15119558).

Endpoint: https://apis.data.go.kr/B551015/API301/Dividend_rate_total

응답 분석 (2026-04-23 실측):
    row 단위가 (pool, combo) — 한 경주의 *모든 출주마/조합* 배당이 row 로 들어옴.

    pool 종류와 의미:
      WIN(단승) — 출주마별 1 row, chulNo = 마번
      PLC(연승) — 출주마별 1 row, chulNo = 마번
      QNL(복승), QPL(쌍승식), EXA(쌍승) — chulNo + chulNo2 (2마 조합)
      TRI(삼복승), TLA(삼쌍승) — chulNo + chulNo2 + chulNo3 (3마 조합)

    공통 필드: rcDate, meet, rcNo, pool, odds, chulNo[, chulNo2, chulNo3]

1차 사이클 범위: WIN + PLC 만 처리 — 출마표/결과 페이지 horse-level 표시용.
복식(QNL/QPL/EXA/TRI/TLA) 은 별도 후속 이터레이션 (race_combo_dividends 등).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API301"
DEFAULT_OPERATION = "Dividend_rate_total"


class RaceDividendClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_race_dividend, ENDPOINT)
        self.operation = operation

    def list_by_date(
        self, rc_date: date, meet: int, *, page_size: int = 200
    ) -> list[dict[str, Any]]:
        """Fetch all dividend rows for a single (meet, date)."""
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
    if s == "" or s == "-":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _clean_str(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if s == "" or s == "-":
        return None
    return s


def _meet_name(item: dict[str, Any]) -> str | None:
    raw = str(item.get("meet") or "").strip()
    if raw in _MEET_NAMES:
        return _MEET_NAMES[raw]
    return raw or None


def _row_key(item: dict[str, Any]) -> tuple[date, str, int, str] | None:
    """(race_date, meet, race_no, horse_no) 키. 결측 시 None."""
    rd = _parse_date(item.get("rcDate") or item.get("rc_date"))
    meet = _meet_name(item)
    race_no = _parse_int(item.get("rcNo") or item.get("rc_no"))
    horse_no = _clean_str(item.get("chulNo"))
    if rd is None or meet is None or race_no is None or horse_no is None:
        return None
    return (rd, meet, race_no, horse_no)


def bucket_horse_dividends(
    items: list[dict[str, Any]]
) -> dict[tuple[date, str, int, str], dict[str, Any]]:
    """WIN/PLC row 들을 (race, horse_no) 단위로 묶어 horse-level 배당 dict 생성.

    같은 (race, horse_no) 의 WIN/PLC 두 row 가 합쳐져 win_rate + plc_rate 한 dict 가 됨.
    pool 이 WIN/PLC 가 아닌 row 는 무시 (복식은 1차 범위 외).
    """
    bucket: dict[tuple[date, str, int, str], dict[str, Any]] = defaultdict(dict)
    for item in items:
        pool = (item.get("pool") or "").strip().upper()
        if pool not in ("WIN", "PLC"):
            continue
        key = _row_key(item)
        if key is None:
            continue
        rd, meet, race_no, horse_no = key
        odds = _parse_number(item.get("odds"))

        slot = bucket[key]
        slot["race_date"] = rd
        slot["meet"] = meet
        slot["race_no"] = race_no
        slot["horse_no"] = horse_no
        if pool == "WIN":
            slot["win_rate"] = odds
            slot["raw_win"] = item
        else:  # PLC
            slot["plc_rate"] = odds
            slot["raw_plc"] = item
    return bucket


def items_to_dividend_rows(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """API 응답 item 리스트 → race_dividends row dict 리스트 (WIN+PLC only)."""
    bucket = bucket_horse_dividends(items)
    rows: list[dict[str, Any]] = []
    for key, slot in bucket.items():
        rows.append(
            {
                "race_date": slot["race_date"],
                "meet": slot["meet"],
                "race_no": slot["race_no"],
                "horse_no": slot["horse_no"],
                "win_rate": slot.get("win_rate"),
                "plc_rate": slot.get("plc_rate"),
                "raw_win": slot.get("raw_win"),
                "raw_plc": slot.get("raw_plc"),
            }
        )
    return rows
