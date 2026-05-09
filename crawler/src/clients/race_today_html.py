"""race.kra.co.kr/seoulMain.do HTML 크롤러 — 당일 발주시각/거리 fallback.

KRA OpenAPI API187 (HorseRaceInfo) 가 현재 빈 응답(items="")을 반환해
races.distance / races.start_time 가 채워지지 않는다. 홈 카로셀에 출전표를
띄우면서 발주시각·거리를 노출하기 위해, 공식 KRA 사이트의 메인 페이지 HTML
(`raceDetail` 앵커의 data-* 속성)을 파싱하는 fallback 경로.

페이지는 EUC-KR 인코딩이며, 한 URL 안에 서울/제주/부경 모두의 당일 경주가
들어 있다. data-* 속성은 안정적이고 가벼워 정규식으로 충분.
"""
from __future__ import annotations

import re
from typing import Any

import httpx

URL = "https://race.kra.co.kr/seoulMain.do"

# data-meet 코드는 OpenAPI 와 동일 — 1=서울, 2=제주, 3=부경(부산경남).
_MEET_NAMES = {"1": "서울", "2": "제주", "3": "부경"}

# raceDetail 앵커는 한 경주에 대해 페이지 안에서 여러 번 반복될 수 있다 (예: 발매중/배당
# 카드 등). data-* 속성이 동일하면 같은 경주이므로 (race_date, meet, race_no) 기준으로 dedup.
# 속성 순서가 살짝 다를 수 있어 각 속성을 따로 lookup.
_ANCHOR_RE = re.compile(
    r'<a\b[^>]*\bclass="[^"]*\braceDetail\b[^"]*"[^>]*>',
    re.DOTALL,
)
_ATTR_RE = re.compile(r'data-([a-zA-Z]+)\s*=\s*"([^"]*)"')


def _parse_anchor(tag: str) -> dict[str, str]:
    return {k: v for k, v in _ATTR_RE.findall(tag)}


def parse_html(html: str) -> list[dict[str, Any]]:
    """HTML 문자열에서 (date/meet/race_no/start_time/distance/race_name) 추출."""
    seen: set[tuple[str, str, int]] = set()
    out: list[dict[str, Any]] = []
    for tag_match in _ANCHOR_RE.finditer(html):
        attrs = _parse_anchor(tag_match.group(0))
        meet_code = attrs.get("meet")
        rc_no_raw = attrs.get("rcNo")
        rc_date_raw = attrs.get("rcDate")
        st_time = attrs.get("stTime")
        rc_dist_raw = attrs.get("rcDist")
        rc_name = attrs.get("rcName")
        if not (meet_code and rc_no_raw and rc_date_raw):
            continue
        if len(rc_date_raw) != 8 or not rc_date_raw.isdigit():
            continue
        try:
            race_no = int(rc_no_raw)
        except ValueError:
            continue
        meet = _MEET_NAMES.get(meet_code)
        if not meet:
            continue
        race_date = f"{rc_date_raw[:4]}-{rc_date_raw[4:6]}-{rc_date_raw[6:8]}"
        key = (race_date, meet, race_no)
        if key in seen:
            continue
        seen.add(key)
        try:
            distance = int(rc_dist_raw) if rc_dist_raw and rc_dist_raw.isdigit() else None
        except ValueError:
            distance = None
        # rcName="일반" 같은 placeholder 는 race_name 으로 부적합 — 실제 대상 경주명만 유의미.
        race_name = rc_name if rc_name and rc_name not in ("", "일반") else None
        # stTime 은 "10:35" 형식. 빈 문자열이면 None.
        start_time = st_time if st_time and re.fullmatch(r"\d{1,2}:\d{2}", st_time) else None
        out.append(
            {
                "race_date": race_date,
                "meet": meet,
                "race_no": race_no,
                "start_time": start_time,
                "distance": distance,
                "race_name": race_name,
            }
        )
    return out


def fetch_today_races(timeout: float = 15.0) -> list[dict[str, Any]]:
    """seoulMain.do 를 가져와 당일 모든 경마장의 경주 메타를 반환.

    페이지는 EUC-KR 인코딩이라 명시적으로 디코드. KRA 가 robots.txt 로
    크롤러를 차단하지 않으며 이 메인 페이지는 익명 GET 으로 접근 가능.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    }
    with httpx.Client(timeout=timeout, follow_redirects=True, headers=headers) as client:
        resp = client.get(URL)
        resp.raise_for_status()
        # KRA 페이지는 charset=euc-kr 로 선언. httpx 의 자동 디코딩은 chardet 추정인데
        # 한글이 망가지는 케이스가 있어 명시.
        html = resp.content.decode("euc-kr", errors="replace")
    return parse_html(html)
