"""경마장(meet) 코드 ↔ 한글 라벨 — 크롤러 전역 단일 진실원.

KRA OpenAPI 요청은 정수 meet 코드(1~4), 응답은 "1".."4" 텍스트 또는 한글로 온다.
DB 의 `meet` 컬럼은 한글 라벨(서울/제주/부경/영천)로 정규화해 저장한다.
(race_plans·trainers·owners 등 raw 저장 테이블은 부경을 "부산경남"으로 받음 —
MEET_CODE_BY_NAME 이 두 라벨 모두 받는다.)

영천(4)은 2026-09 개장 — 시즌 중 매주 일요일 6경주. 비개최일엔 KRA 가 NODATA 를
돌려주므로 루프에 포함해도 호출 1회/일·잡 정도의 비용만 든다.
"""

from __future__ import annotations

MEET_CODES: tuple[int, ...] = (1, 2, 3, 4)

MEET_NAMES: dict[str, str] = {"1": "서울", "2": "제주", "3": "부경", "4": "영천"}

MEET_CODE_BY_NAME: dict[str, int] = {
    "서울": 1,
    "제주": 2,
    "부경": 3,
    "부산경남": 3,
    "영천": 4,
}
