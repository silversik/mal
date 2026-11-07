"""E2E replay 의 가짜 세계 — 외부 API 3종 + race.kra.co.kr HTML 을 한 seam 에서 흉내낸다.

모든 HTTP 는 `httpx.MockTransport(FakeWeb.handler)` 로 들어온다 (conftest 가 httpx.Client
생성자를 감싸 transport 를 주입). 응답 모양은 각 클라이언트의 파싱/매핑 함수
(`api_item_to_*`, `iter_items`, `_raise_for_api_error`, `parse_html` …) 와 docs/api/*.md,
코드 주석의 실측 응답 기술을 따른다:

- KRA (apis.data.go.kr/B551015/<endpoint>/<op>): `{response:{header:{resultCode:'00'},
  body:{items:{item:[...]},totalCount}}}` + pageNo/numOfRows 페이징. 빈 결과는 `items: ""`,
  미공개는 resultCode '03'(NODATA). API308(조교사) 은 XML 로 응답해 xmltodict 폴백 경로를 태운다.
- KMA ASOS 시간자료 (apis.data.go.kr/1360000/...): 같은 envelope, `tm`="YYYY-MM-DD HH:MM",
  값은 문자열 (무강수 rn=""). "전날까지만 제공" 한도를 흉내내 endDt>=오늘이면 오류 코드.
- YouTube Data v3 (www.googleapis.com/youtube/v3/...): channels / playlistItems(pageToken) /
  videos / search.
- race.kra.co.kr/seoulMain.do: EUC-KR HTML, `a.raceDetail` 앵커 data-* 속성.

세계 (FakeWorld) — 경주일 D(토) 하나에 2 경마장(서울·부경) × 2 경주 × 3 마필 + 다음 주
예정일 U 의 출전표. 결과·배당·매출은 시각(가짜 시계) 기준으로 "공표" 된다:
  서울1R 11:30 · 부경1R 12:30 · 서울2R 15:00 · 부경2R D+1 08:30 (KRA 공표 지연 → residual 잡)
  부경 복식(combo) 배당은 D+1 00:00 이후 (→ 야간 gap 백필 잡이 메움)
"""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import httpx

KST = ZoneInfo("Asia/Seoul")

# settings 에 주입하는 더미 키. KRA 키는 data.go.kr "Encoding" 형식(%2B) 으로 넣어
# KraClient 의 unquote 처리 → 서버에서 디코드된 값으로 도착하는지까지 검증한다.
KRA_KEY_ENCODED = "e2e%2Bkra%2Fkey%3D%3D"
KRA_KEY_DECODED = "e2e+kra/key=="
KMA_KEY = "e2e-kma-key"
YT_KEY = "e2e-yt-key"
YT_CHANNEL = "UCe2eKRBCchannel000000"
YT_UPLOADS = "UUe2eKRBCchannel000000"
CHULMA_OP = "entrySheet_2"

MEET_NAME = {1: "서울", 2: "제주", 3: "부경"}
STATION_OF_MEET = {1: 119, 2: 184, 3: 159}

# 마필 12두 — (마번, 마명, 성별, 모색 원문, 마주 idx)
_HORSE_ROWS = [
    ("0041001", "녹색신호", "수", "갈", 0),
    ("0041002", "은빛바람", "암", "밤", 1),
    ("0041003", "천둥번개", "거", "흑갈", 2),
    ("0041004", "가을전설", "수", "회", 3),
    ("0041005", "푸른초원", "암", "갈", 0),
    ("0041006", "황금마차", "수", "밤", 1),
    ("0041007", "바다사나이", "수", "갈", 2),
    ("0041008", "동백꽃", "암", "밤", 3),
    ("0041009", "신인등장", "거", "흑갈", 0),  # D+1 06:00 에야 마필정보 등록 (not-found 원장)
    ("0041010", "해운대질주", "수", "회", 1),
    ("0041011", "광안대교", "암", "갈", 2),
    ("0041012", "태종대", "수", "밤", 3),
]

JOCKEYS = [
    # jk_no, 이름, 소속(응답 텍스트)
    ("080101", "김서울", "서울"),
    ("080102", "이과천", "서울"),
    ("080103", "박경마", "서울"),
    ("080104", "최부경", "부경"),
    ("080105", "정해운", "부경"),
    ("080106", "강광안", "부경"),
    ("080107", "한교체", "서울"),  # 출전표상 원래 기수 → 기수변경으로 이과천 기승
]
TRAINERS = [
    ("070201", "서조교", "Seo Jogyo", "서울"),
    ("070202", "문조교", "Moon Jogyo", "서울"),
    ("070203", "부조교", "Boo Jogyo", "부산경남"),
    ("070204", "남조교", "Nam Jogyo", "부산경남"),
]
OWNERS = [
    ("110301", "(주)말사랑", "Malsarang Co.", "서울"),
    ("110302", "홍마주", "Hong Maju", "서울"),
    ("110303", "부산마주회", "Busan Owners", "부산경남"),
    ("110304", "김마주", "Kim Maju", "부산경남"),
]


@dataclass(frozen=True)
class Horse:
    no: str
    name: str
    sex: str
    color: str
    owner_idx: int

    @property
    def idx(self) -> int:
        return int(self.no[-2:])


HORSES = [Horse(*r) for r in _HORSE_ROWS]
HORSE_BY_NO = {h.no: h for h in HORSES}


@dataclass(frozen=True)
class RaceDef:
    meet: int
    no: int
    distance: int
    grade: str
    rc_name: str  # "일반" 은 race_name 미기록 대상 (placeholder)
    st_time: str  # HH:MM 발주
    horses: tuple[str, str, str]  # chulNo 1..3 순서
    ranks: tuple[int, int, int]  # chulNo 1..3 의 확정착순
    rc_times: tuple[str, str, str]


@dataclass
class Clock:
    """가짜 KST 시계 — conftest 가 src.* 의 date/datetime 을 이 시계로 바꿔 끼운다."""

    now: datetime = field(default_factory=lambda: datetime.now(KST))

    def set(self, d: date, hh: int = 0, mm: int = 0) -> None:
        self.now = datetime(d.year, d.month, d.day, hh, mm, tzinfo=KST)

    @property
    def today(self) -> date:
        return self.now.date()


@dataclass
class Req:
    host: str
    path: str
    params: dict[str, str]
    clock: datetime

    @property
    def kra_endpoint(self) -> str | None:
        parts = self.path.strip("/").split("/")
        if self.host == "apis.data.go.kr" and parts[0] == "B551015" and len(parts) == 3:
            return parts[1]
        return None


def pick_dates(today_kst: date) -> tuple[date, date]:
    """D = 오늘-2 이전의 가장 최근 토요일, U = 내일 이후 첫 금/토/일.

    DB 쪽 시각 비교(NOW()/CURRENT_DATE — 가짜 시계로 못 바꿈)가 끼는 쿼리
    (videos_backfill 의 race_date<=CURRENT_DATE, 즐겨찾기 알림의 race_date>=오늘,
    웹의 KST_TODAY)가 실제 날짜 기준으로도 성립하도록 D 는 과거, U 는 미래에 둔다.
    """
    d = today_kst - timedelta(days=2)
    while d.weekday() != 5:
        d -= timedelta(days=1)
    u = today_kst + timedelta(days=1)
    while u.weekday() not in (4, 5, 6):
        u += timedelta(days=1)
    return d, u


def ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


class FakeWorld:
    def __init__(self, real_now: datetime) -> None:
        self.real_now = real_now
        self.real_today = today_kst = real_now.date()
        self.D, self.U = pick_dates(today_kst)
        D = self.D
        self.races: list[RaceDef] = [
            RaceDef(1, 1, 1200, "국6등급", "일반", "11:00",
                    ("0041001", "0041002", "0041003"), (2, 1, 3),
                    ("1:13.2", "1:12.8", "1:13.9")),
            RaceDef(1, 2, 1400, "국5등급", "가을특별", "14:30",
                    ("0041004", "0041005", "0041006"), (1, 3, 2),
                    ("1:26.1", "1:27.0", "1:26.5")),
            RaceDef(3, 1, 1300, "혼4등급", "일반", "12:00",
                    ("0041007", "0041008", "0041009"), (3, 2, 1),
                    ("1:20.4", "1:19.9", "1:19.5")),
            RaceDef(3, 2, 1600, "혼3등급", "부산일보배", "15:30",
                    ("0041010", "0041011", "0041012"), (1, 2, 3),
                    ("1:38.0", "1:38.4", "1:39.1")),
        ]
        # 결과/배당/매출 공표 시각
        self.publish_at: dict[tuple[int, int], datetime] = {
            (1, 1): self._kst(D, 11, 30),
            (3, 1): self._kst(D, 12, 30),
            (1, 2): self._kst(D, 15, 0),
            (3, 2): self._kst(D + timedelta(days=1), 8, 30),
        }
        self.busan_combo_at = self._kst(D + timedelta(days=1), 0, 0)
        # 신규 마필 0041009 는 D+1 06:00 에야 KRA 마필정보(API42_1)에 올라온다.
        self.horse_registered_at = {"0041009": self._kst(D + timedelta(days=1), 6, 0)}
        # 마필 통산 출전 — D+1 07:00 이후 조회분은 1 증가 (refresh 잡이 갱신하는지 확인용)
        self.horse_count_bump_at = self._kst(D + timedelta(days=1), 7, 0)
        # 다음 주 예정 출전표 (즐겨찾기 알림 대상)
        self.upcoming = RaceDef(1, 1, 1200, "국5등급", "일반", "11:30",
                                ("0041001", "0041004", "0041002"), (0, 0, 0),
                                ("", "", ""))
        # 기수변경: 서울 2R chulNo 2 (0041005) — 한교체 → 이과천
        self.jockey_change = {"meet": 1, "rc_no": 2, "chul_no": 2}
        self.plans = self._build_plans()
        self.videos = self._build_videos()

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _kst(d: date, hh: int, mm: int) -> datetime:
        return datetime(d.year, d.month, d.day, hh, mm, tzinfo=KST)

    def race(self, meet: int, no: int) -> RaceDef:
        return next(r for r in self.races if r.meet == meet and r.no == no)

    def jockey_for(self, r: RaceDef, chul: int, *, at_entry: bool = False) -> tuple[str, str]:
        jc = self.jockey_change
        if at_entry and (r.meet, r.no, chul) == (jc["meet"], jc["rc_no"], jc["chul_no"]):
            no, name, _ = JOCKEYS[6]
            return no, name
        base = 0 if r.meet == 1 else 3
        no, name, _ = JOCKEYS[base + chul - 1]
        return no, name

    @staticmethod
    def trainer_for(h: Horse) -> tuple[str, str]:
        base = 0 if h.idx <= 6 else 2
        t = TRAINERS[base + (h.idx % 2)]
        return t[0], t[1]

    def published(self, meet: int, no: int, now: datetime) -> bool:
        return now >= self.publish_at[(meet, no)]

    def races_on(self, meet: int, d: date) -> list[RaceDef]:
        if d != self.D:
            return []
        return [r for r in self.races if r.meet == meet]

    # ---------------------------------------------------------------- KRA items

    def result_items(self, meet: int, d: date, now: datetime) -> list[dict[str, Any]]:
        out = []
        for r in self.races_on(meet, d):
            if not self.published(r.meet, r.no, now):
                continue
            for i, hno in enumerate(r.horses):
                h = HORSE_BY_NO[hno]
                jk_no, jk_name = self.jockey_for(r, i + 1)
                _, tr_name = self.trainer_for(h)
                out.append({
                    "rcDate": int(ymd(d)),  # KRA JSON 은 숫자/문자 혼재
                    "meet": r.meet,
                    "rcNo": r.no,
                    "chulNo": i + 1,
                    "ord": r.ranks[i],
                    "hrNo": h.no,
                    "hrName": h.name,
                    "sex": h.sex,
                    "age": 4,
                    "rcDist": r.distance,
                    "track": "건조",
                    "rcTime": r.rc_times[i],
                    "wgHr": 470 + h.idx,
                    "wgBudam": 54.0,
                    "differ": "-" if r.ranks[i] == 1 else "1",
                    "hrRating": 60 + h.idx,
                    "jkName": jk_name,
                    "jkNo": jk_no,
                    "trName": tr_name,
                })
        return out

    def dividend_items(self, meet: int, d: date, now: datetime) -> list[dict[str, Any]]:
        out = []
        for r in self.races_on(meet, d):
            if not self.published(r.meet, r.no, now):
                continue
            base = {"rcDate": ymd(d), "meet": str(r.meet), "rcNo": str(r.no)}
            for chul in (1, 2, 3):
                win = f"{2 + chul}.{chul}"
                out.append({**base, "pool": "WIN", "chulNo": str(chul), "odds": win})
                out.append({**base, "pool": "PLC", "chulNo": str(chul), "odds": f"1.{chul + 1}"})
            if r.meet == 3 and now < self.busan_combo_at:
                continue  # 부경 복식배당 공표 지연
            out += [
                {**base, "pool": "QNL", "chulNo": "2", "chulNo2": "1", "odds": "5.4"},
                {**base, "pool": "EXA", "chulNo": "2", "chulNo2": "1", "odds": "9.8"},
                {**base, "pool": "TRI", "chulNo": "3", "chulNo2": "1", "chulNo3": "2",
                 "odds": "12.3"},
                {**base, "pool": "TLA", "chulNo": "2", "chulNo2": "1", "chulNo3": "3",
                 "odds": "45.6"},
                # 같은 조합 중복 응답 (dedupe 경로)
                {**base, "pool": "QNL", "chulNo": "1", "chulNo2": "2", "odds": "5.4"},
            ]
        return out

    POOLS = ("단식", "연식", "쌍식", "복식", "복연", "삼복", "삼쌍")

    def sales_items(self, meet: int, d: date, now: datetime) -> list[dict[str, Any]]:
        out = []
        for r in self.races_on(meet, d):
            if not self.published(r.meet, r.no, now):
                continue
            for k, pool in enumerate(self.POOLS):
                out.append({
                    "rcDate": ymd(d), "meet": r.meet, "rcNo": r.no, "pool": pool,
                    "amt": str(1_000_000 * (k + 1) + r.no), "odds": f"1위 {k + 1}.5",
                })
        return out

    def entry_items(self, meet: int, d: date, now: datetime) -> list[dict[str, Any]]:
        if now.date() < d - timedelta(days=3):
            return []  # 출전표는 경주일 ~3일 전에야 공표
        if d == self.D:
            races = [r for r in self.races if r.meet == meet]
        elif d == self.U and meet == self.upcoming.meet:
            races = [self.upcoming]
        else:
            return []
        out = []
        for r in races:
            for i, hno in enumerate(r.horses):
                h = HORSE_BY_NO[hno]
                jk_no, jk_name = self.jockey_for(r, i + 1, at_entry=True)
                _, tr_name = self.trainer_for(h)
                item = {
                    "rcDate": ymd(d), "meet": str(r.meet), "rcNo": str(r.no),
                    "chulNo": str(i + 1), "hrNo": h.no, "hrName": h.name,
                    "jkNo": jk_no, "jkName": jk_name, "trName": tr_name,
                    "wgBudam": "54.0", "age": "4", "sex": h.sex, "hrRating": str(60 + h.idx),
                    "rcDist": str(r.distance), "rank": r.grade, "rcName": r.rc_name,
                    "ageCond": "연령오픈",
                }
                # 부경 출전표엔 발주시각이 비어 있다 → HTML 크롤링(today_meta)이 채워야 함
                if r.meet == 1:
                    item["stTime"] = f"출발 :{r.st_time}"
                out.append(item)
        return out

    def race_info_items(self, meet: int, year: int) -> list[dict[str, Any]] | None:
        """API187 — 서울만 데이터, 제주 빈 응답, 부경은 500 (None)."""
        if meet == 3:
            return None
        if meet == 2 or year != self.D.year:
            return []
        return [
            {"rcDate": ymd(self.D), "meet": "1", "rcNo": str(r.no), "rcName": r.rc_name,
             "rcDist": str(r.distance), "rank": r.grade, "track": "모래", "trackCond": "건조",
             "chulCnt": "3"}
            for r in self.races if r.meet == 1
        ]

    def _build_plans(self) -> list[dict[str, Any]]:
        D, U = self.D, self.U
        return [
            # 경주일 당일 대상경주 (부경 2R)
            {"meet": "3", "pgDate": ymd(D), "rcName": "부산일보배", "rcNo": "2",
             "grade": "L", "rcDist": "1600", "ageCond": "3세이상", "chaksun1": "300000000",
             "prTot": "550,000,000"},
            {"meet": "1", "pgDate": ymd(D), "rcName": "서울마주협회장배", "rcNo": "2",
             "grade": "L", "rcDist": "1400", "ageCond": "3세이상", "chaksun1": "100000000"},
            {"meet": "2", "pgDate": ymd(D), "rcName": "제주도지사배", "rcNo": "7",
             "grade": "L", "rcDist": "1700", "ageCond": "3세이상", "chaksun1": "50000000"},
            # 다음 주 대상경주 (웹 getUpcomingStakesFromPlans 대상)
            {"meet": "1", "pgDate": ymd(U), "rcName": "그랑프리(G1)", "rcNo": "9",
             "grade": "G1", "rcDist": "2300", "ageCond": "3세이상", "chaksun1": "800000000"},
        ]

    def plan_items(self, meet: int, year: int) -> list[dict[str, Any]]:
        items = [p for p in self.plans if p["meet"] == str(meet) and p["pgDate"][:4] == str(year)]
        if items:
            # KRA 가 rc_year 를 무시하고 다른 연도 계획을 섞어 주는 케이스 (filter 대상)
            items = items + [{"meet": str(meet), "pgDate": f"{year - 1}0505",
                              "rcName": f"작년대상{meet}", "grade": "G3"}]
        return items

    def horse_detail(self, hr_no: str, now: datetime) -> dict[str, Any] | None:
        h = HORSE_BY_NO.get(hr_no)
        if h is None:
            return None
        reg = self.horse_registered_at.get(hr_no)
        if reg is not None and now < reg:
            return None
        ow = OWNERS[h.owner_idx]
        return {
            "hrNo": h.no, "hrNm": h.name, "sanji": "한", "sex": h.sex,
            "birthDt": f"2021030{h.idx % 9 + 1}",
            "fhrNm": "메니피", "fhrNo": "0030001", "mhrNm": f"어미{h.idx}", "mhrNo": "-",
            "rcCnt": 7 if now >= self.horse_count_bump_at else 6, "fstCnt": 2,
            "color": h.color, "char1": "이마가마상,유성", "char2": "-",
            "owNo": ow[0], "owName": ow[1],
        }

    def jockey_items(self) -> list[dict[str, Any]]:
        return [
            {"jkNo": no, "jkName": name, "meet": meet, "birthday": "********",
             "debut": "20150301", "rcCntT": 400 + i, "ord1CntT": 40 + i,
             "ord2CntT": 35, "ord3CntT": 30}
            for i, (no, name, meet) in enumerate(JOCKEYS)
        ]

    def trainer_items(self) -> list[dict[str, Any]]:
        return [
            {"trNo": no, "trName": name, "trNameEn": en, "meet": meet, "stDate": "20100101",
             "rcCntT": str(800 + i), "ord1CntT": str(90 + i), "ord2CntT": "80",
             "ord3CntT": "70", "winRateT": "11.3"}
            for i, (no, name, en, meet) in enumerate(TRAINERS)
        ]

    def owner_items(self) -> list[dict[str, Any]]:
        rows = [
            {"owNo": no, "owName": name, "owNameEn": en, "meet": meet,
             "rcCntT": 120 + i, "ord1CntT": 12 + i, "ord2CntT": 10, "ord3CntT": 9}
            for i, (no, name, en, meet) in enumerate(OWNERS)
        ]
        return rows + [dict(rows[0])]  # 중복 owNo (dedupe 경로)

    def jockey_change_items(self) -> list[dict[str, Any]]:
        jc = self.jockey_change
        r = self.race(jc["meet"], jc["rc_no"])
        h = HORSE_BY_NO[r.horses[jc["chul_no"] - 1]]
        bef = JOCKEYS[6]
        aft_no, aft_name = self.jockey_for(r, jc["chul_no"])
        ev = {"rcDate": ymd(self.D), "meet": "서울", "rcNo": str(r.no),
              "chulNo": str(jc["chul_no"]), "hrNo": h.no, "hrName": h.name,
              "jkBef": bef[0], "jkBefName": bef[1], "jkAft": aft_no, "jkAftName": aft_name,
              "befBudam": "55.0", "aftBudam": "54.0", "reason": "기수부상"}
        partial = {"rcDate": "-", "meet": "", "rcNo": "-", "chulNo": "-", "hrNo": "-"}
        return [ev, partial, dict(ev)]

    def rank_change_items(self) -> list[dict[str, Any]]:
        D = self.D
        out = [
            {"stDate": ymd(D - timedelta(days=14)), "spDate": "-", "meet": "서울",
             "hrNo": "0041001", "hrName": "녹색신호", "blood": "더러브렛",
             "beforeRank": "국6", "rank": "국5"},
        ]
        # 누적 ~수천 row → 페이지 순회 확인용 filler (page_size 200 → 2 page)
        for i in range(249):
            out.append({"stDate": ymd(D - timedelta(days=30 + i % 300)), "spDate": "-",
                        "meet": "부경", "hrNo": f"0099{i:03d}", "hrName": f"필러{i}",
                        "blood": "더러브렛", "beforeRank": "혼4", "rank": "혼3"})
        return out

    def rating_items(self) -> list[dict[str, Any]]:
        out = [{"hrNo": h.no, "hrName": h.name, "meet": "서울" if h.idx <= 6 else "부경",
                "rating1": str(50 + h.idx), "rating2": str(52 + h.idx),
                "rating3": "-", "rating4": f"{55 + h.idx}.0"} for h in HORSES]
        out.append(dict(out[0], rating4="99"))  # 같은 응답 내 중복 hrNo → 마지막 값
        return out

    # ------------------------------------------------------------------ weather

    def weather_items(self, stn: int, start: datetime, end: datetime) -> list[dict[str, Any]]:
        out = []
        t = start
        while t <= end:
            rn = ""
            if t.date() == self.D and stn == 119 and t.hour == 14:
                rn = "1.5"  # 서울 2R(14:30) → 14시 관측 = 약한 비
            if t.date() == self.D and stn == 159 and t.hour == 15:
                rn = "3.0"  # 부경 2R(15:30) → 강한 비
            out.append({"tm": t.strftime("%Y-%m-%d %H:%M"), "stnId": str(stn),
                        "stnNm": {119: "수원", 184: "제주", 159: "부산"}[stn],
                        "ta": f"{10 + t.hour / 10:.1f}", "rn": rn, "ws": "2.1",
                        "wd": "270", "hm": "61.0"})
            t += timedelta(hours=1)
        return out

    # ---------------------------------------------------------------- youtube

    def _video(self, vid: str, title: str, published: datetime) -> dict[str, Any]:
        return {"id": vid, "title": title, "published": published}

    def _race_title(self, meet: int, d: date, no: int) -> str:
        return f"({MEET_NAME[meet]}) {d.strftime('%Y.%m.%d')} {no}경주 KRBC"

    def _build_videos(self) -> list[dict[str, Any]]:
        D = self.D
        k = self._kst
        return [  # uploads playlist 순서 (최신 → 과거)
            self._video("vidMisc0001", "[KRBC] 주간 경마 하이라이트", k(D, 20, 0)),
            self._video("vidS2000001", self._race_title(1, D, 2), k(D, 15, 10)),
            self._video("vidB1000001", self._race_title(3, D, 1), k(D, 12, 40)),
            self._video("vidS1000001", self._race_title(1, D, 1), k(D, 11, 40)),
            self._video("vidOld00001", self._race_title(1, D - timedelta(days=28), 1),
                        k(D - timedelta(days=28), 11, 40)),
            self._video("vidAncient1", self._race_title(1, D - timedelta(days=400), 1),
                        k(D - timedelta(days=400), 11, 40)),
        ]

    @property
    def search_only_videos(self) -> list[dict[str, Any]]:
        # uploads 플레이리스트엔 없고 search 로만 찾히는 영상 (부경 2R)
        return [self._video("vidB2000001", self._race_title(3, self.D, 2),
                            self._kst(self.D, 15, 40))]

    def all_videos(self) -> dict[str, dict[str, Any]]:
        return {v["id"]: v for v in self.videos + self.search_only_videos}


# ======================================================================= HTTP fake


def _kra_body(items: list[dict[str, Any]], page: int, size: int) -> dict[str, Any]:
    total = len(items)
    chunk = items[(page - 1) * size: page * size]
    return {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
            "body": {
                "items": {"item": chunk} if chunk else "",
                "numOfRows": size, "pageNo": page, "totalCount": total,
            },
        }
    }


def _xml_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _kra_xml(items: list[dict[str, Any]], page: int, size: int) -> str:
    total = len(items)
    chunk = items[(page - 1) * size: page * size]
    rows = "".join(
        "<item>" + "".join(f"<{k}>{_xml_escape(str(v))}</{k}>" for k, v in it.items()) + "</item>"
        for it in chunk
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        "<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg>"
        f"</header><body><items>{rows}</items><numOfRows>{size}</numOfRows>"
        f"<pageNo>{page}</pageNo><totalCount>{total}</totalCount></body></response>"
    )


NODATA = {"response": {"header": {"resultCode": "03", "resultMsg": "NODATA_ERROR"}}}


class FakeWeb:
    """단일 MockTransport handler. 모든 요청을 기록하고 host/path/operation 으로 라우팅."""

    # YouTube playlistItems 는 서버측 페이지 크기를 3 으로 캡 — race day 영상 폭주로
    # head(최근 N개)에서 밀리는 상황을 작게 재현 (sync_videos 는 첫 페이지만 본다).
    YT_PAGE = 3

    def __init__(self, world: FakeWorld, clock: Clock) -> None:
        self.w = world
        self.clock = clock
        self.requests: list[Req] = []
        self.unexpected: list[str] = []
        self.kra_routes: dict[tuple[str, str], Callable[[dict[str, str]], Any]] = {
            ("racedetailresult", "getracedetailresult"): self._results,
            ("API301", "Dividend_rate_total"): self._dividends,
            ("API179_1", "salesAndDividendRate_1"): self._sales,
            ("API26_2", CHULMA_OP): self._entries,
            ("API187", "HorseRaceInfo"): self._race_info,
            ("API40", "raceAnnualPlan"): self._plan,
            ("API42_1", "totalHorseInfo_1"): self._horse,
            ("currentjockeyInfo", "getcurrentjockeyinfo"): lambda p: self.w.jockey_items(),
            ("API308", "trainerInfo"): self._trainers_xml,
            ("API309", "horseOwnerInfo"): lambda p: self.w.owner_items(),
            ("API10_1", "jockeyChangeInfo_1"): lambda p: self.w.jockey_change_items(),
            ("raceHorseRatingChangeInfo_2", "raceHorseRatingChangeInfo_2"):
                lambda p: self.w.rank_change_items(),
            ("API77", "raceHorseRating"): lambda p: self.w.rating_items(),
        }

    # ---------------------------------------------------------------- utils

    def reset(self) -> None:
        self.requests.clear()
        self.unexpected.clear()

    def kra_calls(self, endpoint: str | None = None) -> list[Req]:
        return [r for r in self.requests
                if r.kra_endpoint and (endpoint is None or r.kra_endpoint == endpoint)]

    def _bad(self, why: str, req: httpx.Request) -> httpx.Response:
        self.unexpected.append(f"{why}: {req.method} {req.url}")
        return httpx.Response(400, json={"error": why})

    # -------------------------------------------------------------- handler

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        params = {k: v[-1] for k, v in parse_qs(url.query.decode()).items()}
        self.requests.append(Req(url.host, url.path, params, self.clock.now))
        if url.host == "apis.data.go.kr" and url.path.startswith("/B551015/"):
            return self._kra(request, params)
        if url.host == "apis.data.go.kr" and url.path.startswith("/1360000/"):
            return self._kma(request, params)
        if url.host == "www.googleapis.com" and url.path.startswith("/youtube/v3/"):
            return self._youtube(request, params)
        if url.host == "race.kra.co.kr" and url.path == "/seoulMain.do":
            return self._kra_html(request)
        return self._bad("unknown host/path", request)

    # ------------------------------------------------------------------- KRA

    def _kra(self, request: httpx.Request, p: dict[str, str]) -> httpx.Response:
        parts = request.url.path.strip("/").split("/")
        if len(parts) != 3:
            return self._bad("bad KRA path", request)
        _, endpoint, op = parts
        if p.get("serviceKey") != KRA_KEY_DECODED:
            return self._bad(f"serviceKey mismatch {p.get('serviceKey')!r}", request)
        if p.get("_type") != "json":
            return self._bad("missing _type=json", request)
        if "pageNo" not in p or "numOfRows" not in p:
            return self._bad("missing paging params", request)
        route = self.kra_routes.get((endpoint, op))
        if route is None:
            return self._bad(f"unknown KRA op {endpoint}/{op}", request)
        try:
            res = route(p)
        except _BadParams as e:
            return self._bad(str(e), request)
        if isinstance(res, httpx.Response):
            return res
        page, size = int(p["pageNo"]), int(p["numOfRows"])
        return httpx.Response(200, json=_kra_body(res, page, size))

    @staticmethod
    def _need(p: dict[str, str], *keys: str) -> None:
        missing = [k for k in keys if k not in p]
        if missing:
            raise _BadParams(f"missing params {missing}")

    def _meet_date(self, p: dict[str, str]) -> tuple[int, date]:
        self._need(p, "meet", "rc_date")
        return int(p["meet"]), datetime.strptime(p["rc_date"], "%Y%m%d").date()

    def _results(self, p):
        m, d = self._meet_date(p)
        return self.w.result_items(m, d, self.clock.now)

    def _dividends(self, p):
        m, d = self._meet_date(p)
        return self.w.dividend_items(m, d, self.clock.now)

    def _sales(self, p):
        m, d = self._meet_date(p)
        return self.w.sales_items(m, d, self.clock.now)

    def _entries(self, p):
        m, d = self._meet_date(p)
        self._need(p, "rc_month")
        if p["rc_month"] != p["rc_date"][:6]:
            raise _BadParams("rc_month != rc_date[:6]")
        return self.w.entry_items(m, d, self.clock.now)

    def _race_info(self, p):
        self._need(p, "ym_fr", "ym_to", "meet")
        items = self.w.race_info_items(int(p["meet"]), int(p["ym_fr"]))
        if items is None:
            return httpx.Response(500, text="Internal Server Error")
        return items

    def _plan(self, p):
        self._need(p, "rc_year", "meet")
        items = self.w.plan_items(int(p["meet"]), int(p["rc_year"]))
        if not items:
            return httpx.Response(200, json=NODATA)
        return items

    def _horse(self, p):
        if "hr_name" in p:  # CLI sync-horse-name — 마명 검색
            nos = [h.no for h in HORSE_BY_NO.values() if h.name == p["hr_name"]]
        else:
            self._need(p, "hr_no")
            nos = [p["hr_no"]]
        items = [self.w.horse_detail(no, self.clock.now) for no in nos]
        return [it for it in items if it]

    def _trainers_xml(self, p):
        page, size = int(p["pageNo"]), int(p["numOfRows"])
        return httpx.Response(
            200, text=_kra_xml(self.w.trainer_items(), page, size),
            headers={"content-type": "application/xml;charset=UTF-8"},
        )

    # ------------------------------------------------------------------- KMA

    def _kma(self, request: httpx.Request, p: dict[str, str]) -> httpx.Response:
        if request.url.path != "/1360000/AsosHourlyInfoService/getWthrDataList":
            return self._bad("bad KMA path", request)
        if p.get("serviceKey") != KMA_KEY:
            return self._bad("KMA serviceKey mismatch", request)
        expect = {"dataType": "JSON", "dataCd": "ASOS", "dateCd": "HR"}
        if any(p.get(k) != v for k, v in expect.items()):
            return self._bad(f"KMA params {p}", request)
        start = datetime.strptime(p["startDt"] + p["startHh"], "%Y%m%d%H")
        end = datetime.strptime(p["endDt"] + p["endHh"], "%Y%m%d%H")
        if end.date() >= self.clock.today:
            # 실서비스: 전날 자료까지만 제공
            return httpx.Response(200, json={"response": {"header": {
                "resultCode": "99", "resultMsg": "전날 자료까지 조회 가능"}}})
        stn = int(p["stnIds"])
        if stn not in STATION_OF_MEET.values():
            return httpx.Response(200, json=NODATA)  # 미지원 관측소
        items = self.w.weather_items(stn, start, end)
        return httpx.Response(200, json=_kra_body(items, int(p["pageNo"]), int(p["numOfRows"])))

    # --------------------------------------------------------------- YouTube

    def _yt_item(self, v: dict[str, Any]) -> dict[str, Any]:
        return {
            "kind": "youtube#video", "id": v["id"],
            "snippet": {
                "publishedAt": v["published"].astimezone(ZoneInfo("UTC")).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"),
                "channelId": YT_CHANNEL, "channelTitle": "KRBC 한국마사회 경마방송",
                "title": v["title"], "description": "경주 영상 " * 40,
                "thumbnails": {"default": {"url": f"https://i.ytimg.com/vi/{v['id']}/default.jpg"},
                               "high": {"url": f"https://i.ytimg.com/vi/{v['id']}/hqdefault.jpg"}},
            },
            "contentDetails": {"duration": "PT2M35S"},
            "statistics": {"viewCount": "1234"},
        }

    def _youtube(self, request: httpx.Request, p: dict[str, str]) -> httpx.Response:
        if p.get("key") != YT_KEY:
            return httpx.Response(400, json={"error": {"message": "API key not valid"}})
        res = request.url.path.removeprefix("/youtube/v3/")
        if res == "channels":
            if p.get("id") != YT_CHANNEL:
                return httpx.Response(200, json={"items": []})
            return httpx.Response(200, json={"items": [{"id": YT_CHANNEL, "contentDetails": {
                "relatedPlaylists": {"uploads": YT_UPLOADS}}}]})
        if res == "playlistItems":
            if p.get("playlistId") != YT_UPLOADS:
                return httpx.Response(404, json={"error": {"message": "playlistNotFound"}})
            size = min(int(p.get("maxResults", 5)), self.YT_PAGE)
            start = int(p.get("pageToken", "0") or 0)
            vids = self.w.videos[start:start + size]
            body: dict[str, Any] = {"items": [
                {"contentDetails": {"videoId": v["id"], "videoPublishedAt": v["published"]
                                    .astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")}}
                for v in vids]}
            if start + size < len(self.w.videos):
                body["nextPageToken"] = str(start + size)
            return httpx.Response(200, json=body)
        if res == "videos":
            known = self.w.all_videos()
            ids = [i for i in p.get("id", "").split(",") if i]
            return httpx.Response(200, json={"items": [self._yt_item(known[i]) for i in ids
                                                       if i in known]})
        if res == "search":
            if p.get("channelId") != YT_CHANNEL or p.get("type") != "video":
                return self._bad(f"search params {p}", request)
            q = p.get("q", "")
            hits = [v for v in self.w.all_videos().values() if q and q in v["title"]]
            hits = hits[: int(p.get("maxResults", 5))]
            return httpx.Response(200, json={"items": [
                {"kind": "youtube#searchResult", "id": {"kind": "youtube#video",
                                                         "videoId": v["id"]}} for v in hits]})
        return self._bad("unknown youtube resource", request)

    # --------------------------------------------------------- race.kra.co.kr

    def _kra_html(self, request: httpx.Request) -> httpx.Response:
        today = self.clock.today
        anchors = []
        for r in self.w.races_on(1, today) + self.w.races_on(3, today):
            a = (f'<a href="#none" class="raceDetail on" data-meet="{r.meet}" '
                 f'data-rcDate="{ymd(today)}" data-rcNo="{r.no}" data-stTime="{r.st_time}" '
                 f'data-rcDist="{r.distance}" data-rcName="{r.rc_name}">{r.no}R</a>')
            anchors += [a, a]  # 같은 경주 앵커가 카드마다 반복
        anchors.append('<a class="btnRaceInfo" data-meet="1" data-rcNo="9">기타</a>')
        html = ("<html><head><meta charset='euc-kr'><title>한국마사회</title></head><body>"
                + "\n".join(anchors) + "</body></html>")
        return httpx.Response(200, content=html.encode("euc-kr"),
                              headers={"content-type": "text/html;charset=euc-kr"})


class _BadParams(Exception):
    pass


def dumps(o: Any) -> str:
    return json.dumps(o, ensure_ascii=False, default=str)
