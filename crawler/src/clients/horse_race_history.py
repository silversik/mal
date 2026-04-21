"""한국마사회 경마 경주마별 1년간 전적 (publicDataPk=15150072).

Endpoint: https://apis.data.go.kr/B551015/API145/rchrLoyRcod
Operation: rchrLoyRcod

Returns 1-year aggregated stats per horse — 1st through 5th place counts,
prize money, latest race date, etc. Used to enrich the `horses` table with
recent activity metrics shown on the detail page header.

Verified field names (lowercase convention — different from API42_1!):
    hrno          마번
    hrnm          마명
    lstPtinDt     최근경주일자
    loyFcmTcnt    1년 1착 횟수
    loyScmTcnt    1년 2착 횟수
    loyTcmTcnt    1년 3착 횟수
    loyFocmTcnt   1년 4착 횟수
    loyFvcmTcnt   1년 5착 횟수
    loyRcCnt      1년 출전 횟수 (verify)

⚠ 활용신청 필수.
"""
from __future__ import annotations

from typing import Any

from ..config import settings
from .kra_base import KraClient

ENDPOINT = "API145"
DEFAULT_OPERATION = "rchrLoyRcod"


class HorseRaceHistoryClient(KraClient):
    def __init__(self, operation: str = DEFAULT_OPERATION) -> None:
        super().__init__(settings.kra_key_horse_race_history, ENDPOINT)
        self.operation = operation

    def by_horse_no(self, horse_no: str) -> dict[str, Any] | None:
        items = self.iter_items(
            self.operation, page_size=10, max_pages=1, hr_no=horse_no
        )
        return items[0] if items else None

    def by_horse_name(self, horse_name: str) -> list[dict[str, Any]]:
        return self.iter_items(
            self.operation, page_size=100, max_pages=1, hr_name=horse_name
        )

    def top_by_meet(self, rccrs_cd: int, *, page_size: int = 100) -> list[dict[str, Any]]:
        """Without hr_no/hr_name the API returns horses sorted by 1y prize money desc."""
        return self.iter_items(
            self.operation, page_size=page_size, max_pages=1, rccrs_cd=rccrs_cd
        )
