"""경마장(meet) 코드 ↔ 한글 라벨 — 크롤러 전역 단일 진실원.

KRA OpenAPI 요청은 정수 meet 코드(1~4), 응답의 meet 은 API·시기에 따라 "1".."4"
텍스트이거나 한글("부경", "부산경남" …)이다. DB 의 `meet` 컬럼은 **정규 라벨**
(서울/제주/부경/영천) 한 가지로 저장한다 — 응답 값은 반드시 `normalize_meet` 를 거친다.

라벨이 갈라졌던 사고(2026-08~11): 클라이언트가 코드만 라벨로 바꾸고 한글은 그대로
저장해, KRA 가 경주결과·출전표·배당 응답을 "부산경남" 으로 주기 시작한 2026-08-16
부터 같은 부경 경주가 테이블마다 '부경'/'부산경남' 두 라벨로 쌓였다 (영천 결과는
'양천'). races·race_results·race_entries·race_dividends 의 unique 키에 meet 이 들어
있어 라벨이 다르면 다른 경주로 취급된다.

예외 — `race_plans` 만 KRA 원문("부산경남")을 그대로 둔다. unique 키가
(meet, year, race_name) 라 라벨만 바꾸면 같은 대상경주가 두 행이 되고, 웹
(`race_plans.ts`·`/races/schedule`)이 '부산경남' 기준이라 기존 행 정리와 함께
옮겨야 한다. MEET_CODE_BY_NAME 은 그래서 별칭도 받는다.

영천(4)은 2026-09 개장 — 시즌 중 매주 일요일 6경주. 비개최일엔 KRA 가 NODATA 를
돌려주므로 루프에 포함해도 호출 1회/일·잡 정도의 비용만 든다.
"""

from __future__ import annotations

from typing import Any

from .logging import get_logger

log = get_logger(__name__)

MEET_CODES: tuple[int, ...] = (1, 2, 3, 4)

MEET_NAMES: dict[str, str] = {"1": "서울", "2": "제주", "3": "부경", "4": "영천"}

#: 정규 라벨이 아닌 표기 → 정규 라벨. 운영 DB 에 실제로 쌓인 값만 둔다.
#: "양천" 은 2026-11-22 영천 경주결과(race_results)에 저장된 값 — 크롤러에 이 문자열을
#: 만드는 코드가 없어 KRA 응답 원문으로 추정한다 (raw 컬럼 미확인).
MEET_ALIASES: dict[str, str] = {
    "부산경남": "부경",
    "양천": "영천",
}

_LABEL_BY_TEXT: dict[str, str] = {
    **MEET_NAMES,
    **{name: name for name in MEET_NAMES.values()},
    **MEET_ALIASES,
}

#: 저장된 한글 라벨(정규 + 별칭) → API meet 코드. 정리 전 행을 읽는 쪽이 쓴다.
MEET_CODE_BY_NAME: dict[str, int] = {
    **{name: int(code) for code, name in MEET_NAMES.items()},
    **{
        alias: int(code)
        for alias, name in MEET_ALIASES.items()
        for code, n in MEET_NAMES.items()
        if n == name
    },
}

_warned: set[tuple[str, str, str]] = set()


def _warn_once(event: str, raw: str, requested: str) -> None:
    """같은 (이벤트, 원문, 요청 코드) 는 프로세스당 한 번만 — 행마다 찍히지 않게."""
    key = (event, raw, requested)
    if key in _warned:
        return
    _warned.add(key)
    log.warning(event, raw=raw, requested=requested or None)


def meet_label(value: Any) -> str | None:
    """코드("3"·3)·정규 라벨·별칭 → 정규 라벨. 모르는 값·빈 값은 None."""
    if value is None:
        return None
    return _LABEL_BY_TEXT.get(str(value).strip())


def normalize_meet(raw: Any, *, requested: int | str | None = None) -> str | None:
    """KRA 응답의 meet → DB 에 저장할 정규 라벨(서울/제주/부경/영천).

    requested 는 그 응답을 받을 때 요청에 넣은 meet 코드. 응답 값을 알아볼 수 없거나
    비어 있으면 요청 코드의 라벨을 쓴다 (KRA 가 새 표기·오기를 보내도 라벨이 갈라지지
    않게). 응답이 **다른** 경마장으로 읽히면 응답을 믿는다 — API 가 meet 필터를 무시하고
    전체를 돌려줄 때 남의 경주에 요청 라벨을 붙이지 않기 위해서다.

    requested 가 없고 모르는 값이면 원문을 그대로 돌려준다 (행을 버리지 않는다).
    어느 경우든 모르는 값·불일치는 경고 로그를 남긴다. 빈 값은 None.
    """
    text = "" if raw is None else str(raw).strip()
    if text == "-":
        text = ""
    expected = meet_label(requested)
    req = "" if requested is None else str(requested).strip()

    label = _LABEL_BY_TEXT.get(text)
    if label is not None:
        if expected is not None and label != expected:
            _warn_once("meet_label_differs_from_request", text, req)
        return label
    if expected is not None:
        if text:
            _warn_once("meet_label_unknown_using_request", text, req)
        return expected
    if text:
        _warn_once("meet_label_unknown", text, req)
    return text or None
