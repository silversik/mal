"""경마지 UI 확인용 로컬 시드 — 합성 세계(마번 'RF…')를 넣고 발행·정산까지 해 둔다.

실행 (crawler/ 에서):
  DATABASE_URL=postgresql+psycopg://mal:mal_dev_pw@localhost:5432/mal_rf_test \\
    uv run python -m tests.racing_form_seed --db mal_rf_test [--today YYYY-MM-DD]

- 대상: DATABASE_URL 의 서버·계정에서 DB 이름만 --db 로 바꾼다. DB 이름에 e2e/test 가 없거나
  호스트가 localhost 가 아니면 거부한다 (tests/e2e/setup_db.sh 로 만든 prod 레이아웃 DB).
- 멱등: racing_form_* 6개 테이블 TRUNCATE (같은 트랜잭션에서 SET LOCAL
  mal.racing_form_allow_truncate='on') + 자기 세계(마번 'RF%', raw 에 seed 표식이 있는
  races·race_dividends·race_plans)를 지우고 다시 넣는다.
- 결정적: 고정 seed 의 random.Random — --today 가 같으면 같은 세계·같은 발행본.

세계
- 서울(토·일)·부경(금·일)·제주(금·토) 최근 8주, 하루 8~12경주, 경주당 8~12두. 착순·기록·
  결과표 레이팅·기수·조교사·부담·주로 상태·단승/연승 배당. 동명이인 기수(같은 이름, 다른 jkNo),
  착순 없는 행(실격·주행중지) 몇 개.
- 경주일 D = --today 이후(같은 날 포함) 첫 토요일: 서울 12경주(9R 대상경주 '가람컵' G3 —
  race_plans 도)·제주 출전표. 데뷔마·기록 없음·휴양 복귀·경마장 이동·조교사 변경·등급 변동,
  기수 변경 3건(부담 변화 1건, 전·후가 같은 행 1건) + 발행 뒤 기수 변경 1건, stale 출전표 1행.
- 직전 서울 경주일 D′(오늘보다 앞): 출전표·기수 변경 → 발행 → 결과(실격 1·동착 1·출전취소 1,
  12R 배당 없음) → 잠정 정산(D′ 17:45) → 확정(D′+1 13:30) → 정정 공지 1건.
- 기준 r1 은 D′ 동결보다 앞서 등록. 발행은 store.SqlRepo.insert_edition +
  build_edition(live, 창 강제)에 발행 창 안의 시각을 넣어서 한다. DB created_at 은 실제 시계라
  racing-form-verify 의 시계 점검은 이 DB 에서 차이를 보고한다 (합성 세계라 정상).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine, make_url

from src.jobs.racing_form_jobs import settle_racing_form
from src.racing_form import build, definitions, queries, store

KST = ZoneInfo("Asia/Seoul")
SEED = 20261114
PREFIX = "RF"
SEED_TAG = "racing_form_seed"
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")
WEB_BASE = "http://localhost:3000"
HISTORY_DAYS = 56

RF_TABLES = (
    "racing_form_rule_sets", "racing_form_editions", "racing_form_picks",
    "racing_form_race_outcomes", "racing_form_backtests", "racing_form_notices",
)

ERRATUM_TEXT = (
    "3R 출전마 카드의 최근 5전 중 한 경주의 거리 표기가 잘못되었습니다 (1400m → 1300m). "
    "예상·판정에는 영향이 없습니다."
)
STAKES = {"race_no": 9, "name": "가람컵", "grade": "G3", "distance": 1600}

# 이름 재료 (실존 말·사람과 무관한 합성 이름)
_H1 = ("가람", "나래", "다온", "라온", "마루", "바다", "새벽", "아라", "자람", "차오", "하늘",
       "한결", "누리", "별빛", "솔빛", "은빛", "금빛", "푸른", "고요", "단비", "보라", "산들",
       "여름", "겨울", "가을", "봄날", "노을", "이슬", "온새", "해솔")
_H2 = ("질주", "바람", "번개", "천둥", "날개", "용사", "전설", "왕자", "공주", "기사", "샛별",
       "물결", "언덕", "들판", "파도", "구름", "새싹", "등대", "횃불", "화살", "방패", "나무",
       "호수", "초원", "마차", "여왕", "신화", "질풍", "돛대", "꽃길")
_SUR = ("김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권",
        "황", "안", "송", "전", "홍")
_GIV = ("민준", "서준", "도윤", "예준", "시우", "하준", "주원", "지호", "지후", "준우", "준서",
        "건우", "도현", "현우", "지훈", "우진", "선우", "서진", "민재", "현준", "태윤", "한별")
_TRACKS = ("건조", "양호", "양호", "양호", "다습", "포장")


@dataclass(frozen=True)
class MeetCfg:
    meet: str
    code: str
    weekdays: tuple[int, ...]
    races: tuple[int, int]
    distances: tuple[int, ...]
    dist_weights: tuple[int, ...]
    classes: int
    first_post: str
    pool: int
    jockeys: int
    trainers: int
    speed_mps: float
    unrated_pct: int


MEETS: tuple[MeetCfg, ...] = (
    MeetCfg("서울", "1", (5, 6), (9, 12), (1000, 1200, 1300, 1400, 1600, 1800),
            (2, 6, 3, 5, 3, 1), 6, "11:00", 300, 26, 16, 16.4, 0),
    MeetCfg("부경", "3", (4, 6), (9, 12), (1000, 1200, 1300, 1400, 1600, 1800),
            (2, 6, 3, 5, 3, 1), 6, "11:30", 280, 24, 15, 16.3, 0),
    MeetCfg("제주", "2", (4, 5), (8, 10), (900, 1000, 1200, 1400, 1700),
            (2, 5, 5, 3, 1), 4, "9:50", 200, 18, 12, 15.1, 30),
)
CFG = {c.meet: c for c in MEETS}


# ============================================================== 세계 모델


@dataclass
class Horse:
    no: str
    name: str
    meet: str
    sex: str
    age: int
    ability: float
    home: int
    cls: int
    trainer: str
    rating: int
    old_career: int
    starts: int = 0
    wins: int = 0
    last: date | None = None


@dataclass(frozen=True)
class Jockey:
    no: str
    name: str
    skill: float


@dataclass
class Runner:
    horse: Horse
    chul: int
    jockey: Jockey
    trainer: str
    rating: int  # 경주 시점 레이팅 (0 = 미평가)
    budam: int  # 0.1kg
    rank: int | None = None
    time_tenths: int | None = None
    differ: str = "-"
    perf: float = 0.0
    win_odds: int | None = None  # 단승 ×10
    plc_odds: int | None = None
    entry_jockey: Jockey | None = None  # 출전표 기수 (기수 변경 전) — 없으면 jockey
    entry_budam: int | None = None  # 출전표 부담 (변경 전) — 없으면 budam


@dataclass
class Race:
    d: date
    meet: str
    no: int
    distance: int
    grade: str
    start: str
    name: str | None
    track: str
    runners: list[Runner] = field(default_factory=list)
    scratched: list[Runner] = field(default_factory=list)  # 출전표에만 (결과 행 없음)
    dividends: bool = True


@dataclass
class World:
    today: date
    d: date
    d_prev: date
    horses: dict[str, Horse] = field(default_factory=dict)
    jockeys: dict[str, list[Jockey]] = field(default_factory=dict)
    trainers: dict[str, list[str]] = field(default_factory=dict)
    history: list[Race] = field(default_factory=list)  # 결과가 있는 경주 (D′ 포함)
    upcoming: list[Race] = field(default_factory=list)  # D 출전표
    old_results: list[Race] = field(default_factory=list)  # 휴양 복귀마의 옛 경주
    jockey_changes: list[dict[str, Any]] = field(default_factory=list)
    late_jockey_change: dict[str, Any] | None = None
    rank_changes: list[dict[str, Any]] = field(default_factory=list)
    entry_trainers: dict[tuple[date, str], str] = field(default_factory=dict)


def at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime.combine(d, time(hh, mm), tzinfo=KST)


def next_saturday(today: date) -> date:
    return today + timedelta(days=(5 - today.weekday()) % 7)


def previous_seoul_day(before: date) -> date:
    d = before - timedelta(days=1)
    while d.weekday() not in CFG["서울"].weekdays:
        d -= timedelta(days=1)
    return d


def grade_label(cls: int) -> str:
    return f"국{cls}"


def _rcb(tenths: int) -> str:
    """0.1초 → KRA rcTime 'M:SS.f'."""
    m, rest = divmod(tenths, 600)
    return f"{m}:{rest // 10:02d}.{rest % 10}"


def _kg(tenths: int) -> str:
    return f"{tenths // 10}.{tenths % 10}"


def _budam(rating: int) -> int:
    if rating <= 0:
        return 540
    raw = 520 + (rating - 40)
    return max(500, min(600, int(round(raw / 5.0)) * 5))


def _post(first: str, idx: int) -> str:
    h, m = (int(x) for x in first.split(":"))
    total = h * 60 + m + 33 * idx
    return f"{total // 60}:{total % 60:02d}"


# ============================================================== 시뮬레이션


class Sim:
    def __init__(self, today: date) -> None:
        self.rng = random.Random(SEED)
        d = next_saturday(today)
        self.w = World(today=today, d=d, d_prev=previous_seoul_day(min(d, today)))
        names = [a + b for a in _H1 for b in _H2]
        self.rng.shuffle(names)
        self._names = iter(names)
        people = [s + g for s in _SUR for g in _GIV]
        self.rng.shuffle(people)
        self._people = iter(people)

    # ------------------------------------------------------------------ 준비
    def setup(self) -> None:
        for cfg in MEETS:
            jockeys = [
                Jockey(f"08{cfg.code}{j:03d}", next(self._people), self.rng.gauss(0, 0.5))
                for j in range(cfg.jockeys)
            ]
            # 동명이인 — 같은 이름, 다른 기수번호 (서울·부경)
            if cfg.meet in ("서울", "부경"):
                jockeys[1] = Jockey(jockeys[1].no, jockeys[0].name, jockeys[1].skill)
            self.w.jockeys[cfg.meet] = jockeys
            self.w.trainers[cfg.meet] = [next(self._people) for _ in range(cfg.trainers)]
            abilities = sorted(
                (self.rng.gauss(0, 1) for _ in range(cfg.pool)), reverse=True
            )
            for i, ab in enumerate(abilities):
                cls = 1 + min(cfg.classes - 1, i * cfg.classes // cfg.pool)
                self._add_horse(cfg, f"{PREFIX}{cfg.code}{i + 1:04d}", ab, cls)

    def _add_horse(self, cfg: MeetCfg, no: str, ability: float, cls: int,
                   *, rated: bool | None = None, old: int | None = None) -> Horse:
        rng = self.rng
        if rated is None:
            rated = rng.randrange(100) >= cfg.unrated_pct
        rating = max(15, min(105, int(round(55 + 9 * ability + rng.gauss(0, 4))))) if rated else 0
        h = Horse(
            no=no,
            name=next(self._names),
            meet=cfg.meet,
            sex=rng.choice(("수", "암", "거")),
            age=rng.randint(3, 6),
            ability=ability,
            home=rng.choices(cfg.distances, weights=cfg.dist_weights)[0],
            cls=cls,
            trainer=rng.choice(self.w.trainers[cfg.meet]),
            rating=rating,
            old_career=rng.randint(0, 24) if old is None else old,
        )
        self.w.horses[no] = h
        return h

    # ------------------------------------------------------------------ 출전마 고르기
    def _pick(self, cfg: MeetCfg, day: date, cls: int | tuple[int, ...], distance: int, k: int,
              busy: set[str]) -> list[Horse]:
        classes = (cls,) if isinstance(cls, int) else cls

        def free(h: Horse) -> bool:
            return (
                h.meet == cfg.meet
                and h.no not in busy
                and h.no[len(PREFIX):len(PREFIX) + 1] == cfg.code
                and (h.last is None or (day - h.last).days >= 6)
                and h.no[len(PREFIX) + 1].isdigit()
            )

        out: list[Horse] = []
        spread = 0
        while len(out) < k and spread <= cfg.classes:
            want = {c for c0 in classes for c in range(c0 - spread, c0 + spread + 1)}
            cands = [h for h in self.w.horses.values() if free(h) and h.cls in want
                     and h not in out]
            cands.sort(key=lambda h: (abs(h.home - distance) // 200, self.rng.random()))
            out += cands[: k - len(out)]
            spread += 1
        return out

    def _runner(self, h: Horse, chul: int, jockey: Jockey, trainer: str | None = None) -> Runner:
        return Runner(h, chul, jockey, trainer or h.trainer, h.rating, _budam(h.rating))

    def _field(self, race: Race, horses: list[Horse]) -> None:
        cfg = CFG[race.meet]
        gates = list(range(1, len(horses) + 1))
        self.rng.shuffle(gates)
        riders = self.rng.sample(self.w.jockeys[cfg.meet], len(horses))
        for h, g, j in zip(horses, gates, riders, strict=True):
            race.runners.append(self._runner(h, g, j))
        race.runners.sort(key=lambda r: r.chul)

    def make_race(self, cfg: MeetCfg, day: date, no: int, busy: set[str], *,
                  stakes: bool = False, k: int | None = None) -> Race:
        rng = self.rng
        if stakes:
            distance, cls, name, grade = STAKES["distance"], (1, 2), STAKES["name"], STAKES["grade"]
        else:
            distance = rng.choices(cfg.distances, weights=cfg.dist_weights)[0]
            cls = rng.choices(range(1, cfg.classes + 1),
                              weights=[1 + c for c in range(cfg.classes)])[0]
            name, grade = None, grade_label(cls)
        race = Race(day, cfg.meet, no, distance, grade, _post(cfg.first_post, no - 1), name,
                    "양호")
        n = k or rng.randint(8, 12 if cfg.meet != "제주" else 10)
        horses = self._pick(cfg, day, cls, distance, n, busy)
        busy.update(h.no for h in horses)
        self._field(race, horses)
        return race

    # ------------------------------------------------------------------ 경주 결과
    def run_race(self, race: Race, *, dq: bool = True, dead_heat: bool = False) -> None:
        rng = self.rng
        cfg = CFG[race.meet]
        for r in race.runners:
            fit = -0.18 * abs(r.horse.home - race.distance) / 200
            r.perf = r.horse.ability + 0.35 * r.jockey.skill + fit + rng.gauss(0, 0.9)
        order = sorted(race.runners, key=lambda r: (-r.perf, r.chul))
        base = race.distance / cfg.speed_mps + 0.25 * (int(race.grade[-1]) - 3
                                                         if race.grade[-1].isdigit() else 0)
        base += {"건조": 0.4, "양호": 0.0, "다습": -0.3, "포장": -0.5}.get(race.track, 0.0)
        t = int(round((base + rng.gauss(0, 0.4)) * 10))
        for rank, r in enumerate(order, start=1):
            if rank > 1:
                t += rng.choice((0, 1, 1, 2, 3, 4, 5))
            r.rank, r.time_tenths = rank, t
            r.differ = "-" if rank == 1 else rng.choice(("코", "머리", "목", "1/2", "1", "2"))
        if dead_heat and len(order) >= 3:
            order[1].rank, order[1].time_tenths, order[1].differ = 1, order[0].time_tenths, "동착"
        if dq and len(order) >= 8:
            roll = rng.randrange(160)
            if roll == 0:  # 실격 — 기록은 있고 착순 없음
                victim = order[rng.randrange(len(order))]
                victim.rank, victim.differ = None, "실격"
            elif roll == 1:  # 주행중지 — 착순·기록 없음
                victim = order[rng.randrange(len(order))]
                victim.rank, victim.time_tenths, victim.differ = None, None, "주행중지"
        self._renumber(order)
        self._odds(race)
        for r in race.runners:
            h = r.horse
            h.starts += 1
            h.last = race.d
            if r.rank == 1:
                h.wins += 1
            if h.rating > 0 and r.rank is not None:
                n = len(race.runners)
                if r.rank == 1:
                    h.rating += rng.randint(3, 5)
                elif r.rank == 2:
                    h.rating += rng.randint(1, 2)
                elif r.rank == 3:
                    h.rating += 1
                elif r.rank > n - n // 3:
                    h.rating = max(15, h.rating - rng.randint(1, 2))

    @staticmethod
    def _renumber(order: list[Runner]) -> None:
        """착순 다시 매기기 — 동착(같은 rank)은 유지하고, 착순 없는 말을 빼고 이어 붙인다."""
        ranked = [r for r in order if r.rank is not None]
        pos = 0
        prev: int | None = None
        for i, r in enumerate(ranked):
            if prev is not None and r.rank == prev:
                continue  # 동착 — 앞 말과 같은 착순
            prev = r.rank
            pos = i + 1
            r.rank = pos

    def _odds(self, race: Race) -> None:
        weights = [math.exp(1.1 * (r.horse.ability + 0.3 * r.jockey.skill)) for r in race.runners]
        total = sum(weights)
        for r, wgt in zip(race.runners, weights, strict=True):
            p = wgt / total
            r.win_odds = max(11, int(round(7.5 / p)))  # ×10
            r.plc_odds = max(10, r.win_odds // 3)

    # ------------------------------------------------------------------ 세계
    def build(self) -> World:
        w = self.w
        self.setup()
        start = w.d - timedelta(days=HISTORY_DAYS)
        days: list[tuple[date, MeetCfg]] = []
        day = start
        while day < w.today:
            for cfg in MEETS:
                if day.weekday() in cfg.weekdays:
                    days.append((day, cfg))
            day += timedelta(days=1)
        for day, cfg in days:
            busy: set[str] = set()
            n = 12 if (day, cfg.meet) == (w.d_prev, "서울") else self.rng.randint(*cfg.races)
            track = self.rng.choice(_TRACKS)
            is_prev = (day, cfg.meet) == (w.d_prev, "서울")
            for no in range(1, n + 1):
                race = self.make_race(cfg, day, no, busy, k=11 if is_prev and no == 3 else None)
                race.track = track
                if is_prev:
                    self._special_prev(race)
                else:
                    self.run_race(race)
                w.history.append(race)
        self._upcoming()
        return w

    def _special_prev(self, race: Race) -> None:
        """D′ 서울 — 3R 출전취소(출전표에만), 5R 실격, 7R 1착 동착, 12R 배당 없음, 4R 기수 변경."""
        w = self.w
        if race.no == 3 and len(race.runners) > 8:
            top = max(race.runners, key=lambda r: (r.rating, -r.chul))
            race.runners.remove(top)
            race.scratched.append(top)
        self.run_race(race, dq=False, dead_heat=race.no == 7)
        if race.no == 5:
            victim = sorted(race.runners, key=lambda r: r.rank or 99)[2]
            victim.rank, victim.differ = None, "실격"
            self._renumber(sorted(race.runners, key=lambda r: (r.rank or 99, r.chul)))
        if race.no == 12:
            race.dividends = False
        if race.no == 4:
            r = sorted(race.runners, key=lambda x: x.chul)[1]
            new = self._spare_jockey(race, r)
            ts = at(w.d_prev - timedelta(days=1), 6, 25)
            w.jockey_changes.append(
                self._jc(race, r, r.jockey, new, "기수 부상", r.budam, r.budam - 10, ts))
            r.entry_jockey, r.entry_budam = r.jockey, r.budam
            r.jockey = new
            r.budam -= 10

    def _spare_jockey(self, race: Race, r: Runner) -> Jockey:
        """그 경주에 타지 않는 다른 이름의 기수 하나 (무작위, 결정적)."""
        riders = {x.jockey.no for x in race.runners}
        names = {x.jockey.name for x in race.runners}
        pool = [j for j in self.w.jockeys[race.meet] if j.no not in riders and j.name not in names]
        return self.rng.choice(pool)

    def _jc(self, race: Race, r: Runner, before: Jockey, after: Jockey, reason: str,
            wb: int | None, wa: int | None, ts: datetime) -> dict[str, Any]:
        return dict(
            race_date=race.d, meet=race.meet, race_no=race.no, chul_no=r.chul,
            horse_no=r.horse.no, horse_name=r.horse.name, jk_no_before=before.no,
            jk_name_before=before.name, jk_no_after=after.no, jk_name_after=after.name,
            weight_before=_kg(wb) if wb is not None else None,
            weight_after=_kg(wa) if wa is not None else None, reason=reason, ts=ts,
        )

    def _upcoming(self) -> None:
        """D — 서울 12경주(9R 대상경주) · 제주.

        데뷔·기록 없음·휴양 복귀·이동·조교사 변경·등급 변동·기수 변경(발행 전 3 + 발행 뒤 1).
        """
        w, rng = self.w, self.rng
        d = w.d
        seoul, jeju = CFG["서울"], CFG["제주"]
        busy: set[str] = set()
        races_s = [self.make_race(seoul, d, no, busy, stakes=no == STAKES["race_no"])
                   for no in range(1, 13)]
        races_j = [self.make_race(jeju, d, no, busy) for no in range(1, rng.randint(8, 10) + 1)]

        def add(race: Race, h: Horse, trainer: str | None = None) -> Runner:
            used = {r.chul for r in race.runners}
            chul = max(used) + 1 if used else 1
            riders = {r.jockey.no for r in race.runners}
            j = next(x for x in w.jockeys[race.meet] if x.no not in riders)
            r = self._runner(h, chul, j, trainer)
            race.runners.append(r)
            return r

        # 데뷔 2두 (이력 0, 마스터 0) · 기록 없음 1두 (마스터 > 0)
        for i, race_no in enumerate((1, 3)):
            h = self._add_horse(seoul, f"{PREFIX}1D{i + 1:03d}", 0.3, 6, rated=False, old=0)
            add(races_s[race_no - 1], h)
        h = self._add_horse(seoul, f"{PREFIX}1N001", 0.0, 5, rated=True, old=7)
        add(races_s[1], h)
        # 휴양 복귀 — 200일 · 120일 전 마지막 출주 (옛 경주 8두)
        for i, (race_no, ago) in enumerate(((4, 200), (5, 120))):
            h = self._add_horse(seoul, f"{PREFIX}1L{i + 1:03d}", 0.8, 3, rated=True, old=15)
            old = Race(d - timedelta(days=ago), "서울", 6 + i, 1400, "국3", "14:00", None, "양호")
            others = [self._add_horse(seoul, f"{PREFIX}1O{i}{k:02d}", rng.gauss(0, 1), 3,
                                      rated=True, old=10) for k in range(7)]
            self._field(old, [h, *others])
            self.run_race(old, dq=False)
            w.old_results.append(old)
            add(races_s[race_no - 1], h)
        # 경마장 이동 — 부경 말 1두가 서울로
        mover = next(x for x in w.horses.values() if x.meet == "부경" and x.starts >= 2
                     and x.last is not None and (d - x.last).days >= 6)
        add(races_s[5], mover)
        # 조교사 변경 2두 (출전표 조교사 ≠ 직전 출주)
        changed = [r for r in races_s[6].runners if r.horse.starts][:1] + \
                  [r for r in races_j[1].runners if r.horse.starts][:1]
        for r in changed:
            pool = [t for t in w.trainers[r.horse.meet] if t != r.horse.trainer]
            r.trainer = rng.choice(pool)
        # 등급 변동 (마지막 출주 뒤 적용) — 강급 2 · 승급 1
        for race, direction in ((races_s[7], +1), (races_s[9], +1), (races_j[2], -1)):
            r = next(x for x in race.runners if x.horse.last is not None)
            before = r.horse.cls
            after = max(1, min(CFG[race.meet].classes, before + direction))
            if after == before:
                after = before - direction
            w.rank_changes.append(dict(
                horse_no=r.horse.no, st_date=d - timedelta(days=3), horse_name=r.horse.name,
                meet=race.meet, before=f"국{before}", after=f"국{after}"))
        # 오래된 등급 변동 (마지막 출주 전 — 배지 없음)
        for r in races_s[0].runners[:2]:
            w.rank_changes.append(dict(
                horse_no=r.horse.no, st_date=d - timedelta(days=300), horse_name=r.horse.name,
                meet="서울", before="국6", after="국5"))
        # 기수 변경 (발행 전 06:25) — 부상 · 부담 변화 · 전후 같은 이름
        pre = at(d - timedelta(days=1), 6, 25)
        for race_no, reason, wdelta, same in ((2, "기수 부상", 0, False),
                                              (4, "기수 변경", -10, False),
                                              (6, "착오 정정", 0, True)):
            race = races_s[race_no - 1]
            r = next(x for x in sorted(race.runners, key=lambda x: x.chul)
                     if x.horse.no.startswith(f"{PREFIX}1") and x.horse.no[3].isdigit())
            new = r.jockey if same else self._spare_jockey(race, r)
            wb = r.budam
            wa = r.budam + wdelta if wdelta else None
            w.jockey_changes.append(self._jc(race, r, r.jockey, new, reason,
                                             wb if wdelta else None, wa, pre))
            r.entry_jockey, r.entry_budam = r.jockey, r.budam
            r.jockey = new
            if wa is not None:
                r.budam = wa
        # 발행 뒤 기수 변경 (D 06:25) — 발행본은 그대로, 화면이 덧씌운다
        race = races_s[6]
        r = sorted(race.runners, key=lambda x: x.chul)[0]
        new = self._spare_jockey(race, r)
        w.late_jockey_change = self._jc(race, r, r.jockey, new, "기수 사정", None, None,
                                        at(d, 6, 25))
        for race in (*races_s, *races_j):
            race.runners.sort(key=lambda x: x.chul)
        w.upcoming = [*races_s, *races_j]


def build_world(today: date) -> World:
    return Sim(today).build()


# ============================================================== DB


def _raw(**kv: Any) -> str:
    return json.dumps({k: v for k, v in kv.items() if v is not None}, ensure_ascii=False)


def _ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def _race_row(race: Race) -> dict[str, Any]:
    return dict(
        race_date=race.d, meet=race.meet, race_no=race.no, race_name=race.name,
        distance=race.distance, grade=race.grade, track_type="더트",
        track_condition=race.track, entry_count=len(race.runners) + len(race.scratched),
        start_time=race.start,
        raw=_raw(seed=SEED_TAG, rcDist=str(race.distance)),
    )


def _result_rows(race: Race) -> list[dict[str, Any]]:
    cfg = CFG[race.meet]
    rows = []
    for r in race.runners:
        budam: Any = _kg(r.budam) if race.meet != "부경" else r.budam / 10
        rows.append(dict(
            horse_no=r.horse.no, race_date=race.d, meet=race.meet, race_no=race.no,
            track_condition=race.track, rank=r.rank,
            record_time=(f"{r.time_tenths // 10}.{r.time_tenths % 10}"
                         if r.time_tenths is not None else None),
            weight=str(440 + int(r.horse.ability * 20) % 80),
            jockey_name=r.jockey.name, trainer_name=r.trainer,
            raw=_raw(
                rcDate=int(_ymd(race.d)), meet=cfg.code, rcNo=race.no, chulNo=r.chul,
                ord=r.rank if r.rank is not None else 0, hrNo=r.horse.no, hrName=r.horse.name,
                sex=r.horse.sex, age=r.horse.age, rcDist=race.distance, track=race.track,
                rcTime=_rcb(r.time_tenths) if r.time_tenths is not None else "-",
                wgBudam=budam, differ=r.differ, hrRating=r.rating,
                jkName=r.jockey.name, jkNo=r.jockey.no, trName=r.trainer,
            ),
        ))
    return rows


def _dividend_rows(race: Race) -> list[dict[str, Any]]:
    if not race.dividends:
        return []
    return [
        dict(race_date=race.d, meet=race.meet, race_no=race.no, horse_no=str(r.chul),
             win_rate=_kg(r.win_odds or 0), plc_rate=_kg(r.plc_odds or 0),
             raw_win=_raw(seed=SEED_TAG, pool="WIN", chulNo=str(r.chul), odds=_kg(r.win_odds or 0)),
             raw_plc=_raw(seed=SEED_TAG, pool="PLC", chulNo=str(r.chul),
                          odds=_kg(r.plc_odds or 0)))
        for r in race.runners
    ]


def _entry_rows(race: Race, batch: datetime, fetched: datetime) -> list[dict[str, Any]]:
    cfg = CFG[race.meet]
    rows = []
    for r in sorted([*race.runners, *race.scratched], key=lambda x: x.chul):
        jk = r.entry_jockey or r.jockey
        budam = r.entry_budam if r.entry_budam is not None else r.budam
        rows.append(dict(
            race_date=race.d, meet=race.meet, race_no=race.no, horse_no=r.horse.no,
            chul_no=r.chul, horse_name=r.horse.name, jk_no=jk.no,
            jockey_name=jk.name, trainer_name=r.trainer, age=str(r.horse.age),
            sex=r.horse.sex, rating=r.rating,
            raw=_raw(rcDate=_ymd(race.d), meet=cfg.code, rcNo=str(race.no), chulNo=str(r.chul),
                     hrNo=r.horse.no, hrName=r.horse.name, jkNo=jk.no,
                     jkName=jk.name, trName=r.trainer, wgBudam=_kg(budam),
                     age=str(r.horse.age), sex=r.horse.sex, hrRating=str(r.rating),
                     rcDist=str(race.distance), rank=f"{race.grade}등급"
                     if race.grade.startswith("국") else race.grade,
                     rcName=race.name or "일반", stTime=f"출발 :{race.start}"),
            fetched_at=fetched, updated_at=batch,
        ))
    return rows


def _jc_row(jc: dict[str, Any]) -> dict[str, Any]:
    row = {k: v for k, v in jc.items() if k != "ts"}
    row["raw"] = _raw(seed=SEED_TAG, reason=jc["reason"])
    row["fetched_at"] = row["updated_at"] = jc["ts"]
    return row


_SQL = {
    "horses": """
        INSERT INTO horses (horse_no, horse_name, sex, total_race_count, first_place_count)
        VALUES (:horse_no, :horse_name, :sex, :total, :wins)""",
    "races": """
        INSERT INTO races (race_date, meet, race_no, race_name, distance, grade, track_type,
                           track_condition, entry_count, start_time, raw)
        VALUES (:race_date, :meet, :race_no, :race_name, :distance, :grade, :track_type,
                :track_condition, :entry_count, :start_time, CAST(:raw AS jsonb))""",
    "results": """
        INSERT INTO race_results (horse_no, race_date, meet, race_no, track_condition, rank,
                                  record_time, weight, jockey_name, trainer_name, raw)
        VALUES (:horse_no, :race_date, :meet, :race_no, :track_condition, :rank,
                CAST(:record_time AS numeric), CAST(:weight AS numeric), :jockey_name,
                :trainer_name, CAST(:raw AS jsonb))""",
    "dividends": """
        INSERT INTO race_dividends (race_date, meet, race_no, horse_no, win_rate, plc_rate,
                                    raw_win, raw_plc)
        VALUES (:race_date, :meet, :race_no, :horse_no, CAST(:win_rate AS numeric),
                CAST(:plc_rate AS numeric), CAST(:raw_win AS jsonb), CAST(:raw_plc AS jsonb))""",
    "entries": """
        INSERT INTO race_entries (race_date, meet, race_no, horse_no, chul_no, horse_name, jk_no,
                                  jockey_name, trainer_name, age, sex, rating, raw, fetched_at,
                                  updated_at)
        VALUES (:race_date, :meet, :race_no, :horse_no, :chul_no, :horse_name, :jk_no,
                :jockey_name, :trainer_name, :age, :sex, :rating, CAST(:raw AS jsonb),
                :fetched_at, :updated_at)""",
    "jockey_changes": """
        INSERT INTO jockey_changes (race_date, meet, race_no, chul_no, horse_no, horse_name,
                                    jk_no_before, jk_name_before, jk_no_after, jk_name_after,
                                    weight_before, weight_after, reason, raw, fetched_at,
                                    updated_at)
        VALUES (:race_date, :meet, :race_no, :chul_no, :horse_no, :horse_name, :jk_no_before,
                :jk_name_before, :jk_no_after, :jk_name_after, CAST(:weight_before AS numeric),
                CAST(:weight_after AS numeric), :reason, CAST(:raw AS jsonb), :fetched_at,
                :updated_at)""",
    "rank_changes": """
        INSERT INTO horse_rank_changes (horse_no, st_date, horse_name, meet, blood, before_rank,
                                        after_rank, raw)
        VALUES (:horse_no, :st_date, :horse_name, :meet, '더러브렛', :before, :after,
                CAST(:raw AS jsonb))""",
    "plans": """
        INSERT INTO race_plans (meet, year, race_date, race_no, race_name, grade, distance,
                                track_type, age_cond, raw)
        VALUES (:meet, :year, :race_date, :race_no, :race_name, :grade, :distance, '더트',
                '3세 이상', CAST(:raw AS jsonb))""",
}


def _exec(conn: Connection, key: str, rows: list[dict[str, Any]]) -> None:
    if rows:
        conn.execute(text(_SQL[key]), rows)


def tx_factory(engine: Engine) -> Any:
    @contextmanager
    def tx() -> Iterator[Connection]:
        with engine.begin() as c:
            yield c

    return tx


def cleanup(engine: Engine) -> None:
    """racing_form_* TRUNCATE (GUC 는 이 트랜잭션에서만) + 시드 세계 삭제."""
    with engine.begin() as c:
        c.execute(text("SET LOCAL lock_timeout = '10s'"))
        c.execute(text("SET LOCAL mal.racing_form_allow_truncate = 'on'"))
        c.execute(text(f"TRUNCATE {', '.join(RF_TABLES)} RESTART IDENTITY CASCADE"))
        like = {"p": f"{PREFIX}%"}
        for table in ("race_entries", "jockey_changes", "horse_rank_changes", "race_results"):
            c.execute(text(f"DELETE FROM {table} WHERE horse_no LIKE :p"), like)
        tag = {"t": SEED_TAG}
        c.execute(text("DELETE FROM race_dividends WHERE raw_win ->> 'seed' = :t"), tag)
        c.execute(text("DELETE FROM races WHERE raw ->> 'seed' = :t"), tag)
        c.execute(text("DELETE FROM race_plans WHERE raw ->> 'seed' = :t"), tag)
        c.execute(text("DELETE FROM horses WHERE horse_no LIKE :p"), like)


@dataclass(frozen=True)
class SeedInfo:
    today: date
    d: date
    d_prev: date
    editions: dict[str, int]  # "D|서울" → id
    registered_at: datetime
    urls: tuple[str, ...]


def _publish(engine: Engine, repo: store.SqlRepo, d: date, meet: str, now: datetime) -> int:
    r1 = definitions.get("r1")
    with queries.read_only_provider(tx_factory(engine)) as p:
        res = build.build_edition(p, d, meet, now, r1, mode="live", enforce_window=True)
    edition_id = repo.insert_edition(res, now)
    if not edition_id:
        raise RuntimeError(f"{d} {meet} 발행 실패 (이미 있음)")
    return edition_id


def _settle(engine: Engine, repo: store.SqlRepo, now: datetime) -> int:
    with queries.read_only_provider(tx_factory(engine)) as p:
        n, failures = settle_racing_form(now, repo=repo, provider=p)
    if failures:
        raise RuntimeError(f"정산 실패: {failures}")
    return n


def seed(engine: Engine, today: date) -> SeedInfo:
    """세계를 만들어 넣고 발행·정산 → SeedInfo."""
    w = build_world(today)
    tx = tx_factory(engine)
    repo = store.SqlRepo(tx)
    d, dp = w.d, w.d_prev
    cleanup(engine)

    # ---- 마스터 (현재 상태)
    horses = [dict(horse_no=h.no, horse_name=h.name, sex=h.sex, total=h.old_career + h.starts,
                   wins=h.wins) for h in w.horses.values()]
    prev_races = [r for r in w.history if (r.d, r.meet) == (dp, "서울")]
    before = [r for r in w.history if r.d < dp]
    after = [r for r in w.history if r.d >= dp and (r.d, r.meet) != (dp, "서울")]
    with engine.begin() as c:
        _exec(c, "horses", horses)
        # ---- A. D′ 이전 결과 + 휴양 복귀마의 옛 경주
        _exec(c, "races", [_race_row(r) for r in before])
        _exec(c, "results", [x for r in (*before, *w.old_results) for x in _result_rows(r)])
        _exec(c, "dividends", [x for r in before for x in _dividend_rows(r)])
        # ---- D′ 출전표 · 기수 변경, 등급 변동(적용일로 as-of)
        _exec(c, "races", [_race_row(r) for r in prev_races])
        _exec(c, "entries", [x for r in prev_races for x in _entry_rows(
            r, at(dp - timedelta(days=1), 15), at(dp - timedelta(days=3), 16))])
        _exec(c, "jockey_changes", [_jc_row(j) for j in w.jockey_changes if j["race_date"] == dp])
        _exec(c, "rank_changes", [dict(x, raw=_raw(seed=SEED_TAG)) for x in w.rank_changes])

    # ---- 기준 정의 등록 (D′ 동결보다 앞)
    registered = at(dp - timedelta(days=7), 10)
    repo.ensure_rule_set(definitions.get("r1"), registered)

    # ---- D′ 발행 → 결과 → 정산 → 정정
    eid_prev = _publish(engine, repo, dp, "서울", at(dp - timedelta(days=1), 18, 5))
    with engine.begin() as c:
        _exec(c, "results", [x for r in prev_races for x in _result_rows(r)])
        _exec(c, "dividends", [x for r in prev_races for x in _dividend_rows(r)])
        _exec(c, "races", [_race_row(r) for r in after])
        _exec(c, "results", [x for r in after for x in _result_rows(r)])
        _exec(c, "dividends", [x for r in after for x in _dividend_rows(r)])
    _settle(engine, repo, at(dp, 17, 45))
    _settle(engine, repo, at(dp + timedelta(days=1), 13, 30))
    repo.record_notice(
        kind="erratum", race_date=dp, meet="서울", edition_id=eid_prev,
        public_text=ERRATUM_TEXT,
        dedup_key=store.operator_notice_key("erratum", dp, "서울", ERRATUM_TEXT),
        noticed_at=at(dp, 9, 10), detail={}, source="operator",
    )

    # ---- D 출전표 (서울·제주) · 대상경주 계획 · 기수 변경(발행 전)
    batch, fetched = at(d - timedelta(days=1), 15), at(d - timedelta(days=3), 16)
    with engine.begin() as c:
        _exec(c, "races", [_race_row(r) for r in w.upcoming])
        _exec(c, "entries", [x for r in w.upcoming for x in _entry_rows(r, batch, fetched)])
        # 출전취소 잔존(stale) — 배치보다 3시간 오래된 행 → 제외 (경주의 1/n 이라 경고 없음)
        stale_race = next(r for r in w.upcoming if (r.meet, r.no) == ("서울", 5))
        stale_horse = next(h for h in w.horses.values() if h.meet == "서울" and h.last
                           and all(h.no != x.horse.no for r in w.upcoming for x in r.runners))
        _exec(c, "entries", [dict(
            race_date=d, meet="서울", race_no=5, horse_no=stale_horse.no,
            chul_no=len(stale_race.runners) + 1, horse_name=stale_horse.name,
            jk_no=None, jockey_name=None, trainer_name=stale_horse.trainer,
            age=str(stale_horse.age), sex=stale_horse.sex, rating=stale_horse.rating,
            raw=_raw(seed=SEED_TAG, hrRating=str(stale_horse.rating), wgBudam="54.0"),
            fetched_at=fetched, updated_at=batch - timedelta(hours=3))])
        _exec(c, "jockey_changes", [_jc_row(j) for j in w.jockey_changes if j["race_date"] == d])
        _exec(c, "plans", [dict(
            meet="서울", year=d.year, race_date=d, race_no=STAKES["race_no"],
            race_name=STAKES["name"], grade=STAKES["grade"], distance=STAKES["distance"],
            raw=_raw(seed=SEED_TAG, pgDate=_ymd(d)))])

    eid_s = _publish(engine, repo, d, "서울", at(d - timedelta(days=1), 18, 5))
    eid_j = _publish(engine, repo, d, "제주", at(d - timedelta(days=1), 18, 6))
    # ---- 발행 뒤 기수 변경 (화면의 '발행 후 기수 변경' 상자)
    if w.late_jockey_change is not None:
        with engine.begin() as c:
            _exec(c, "jockey_changes", [_jc_row(w.late_jockey_change)])

    urls = (
        f"{WEB_BASE}/form",
        f"{WEB_BASE}/form/{d.isoformat()}/seoul",
        f"{WEB_BASE}/form/{d.isoformat()}/seoul/1",
        f"{WEB_BASE}/form/{dp.isoformat()}/seoul",
        f"{WEB_BASE}/form/{dp.isoformat()}/seoul/1",
        f"{WEB_BASE}/form/record",
    )
    return SeedInfo(
        today=today, d=d, d_prev=dp,
        editions={f"{dp}|서울": eid_prev, f"{d}|서울": eid_s, f"{d}|제주": eid_j},
        registered_at=registered, urls=urls,
    )


# ============================================================== CLI


def assert_safe_url(url: str) -> None:
    """localhost 의 e2e/test DB 만 (tests/e2e/setup_db.sh 와 같은 이름 규칙)."""
    u = make_url(url)
    host = (u.host or "").lower()
    if host not in LOCAL_HOSTS:
        raise SystemExit(f"[seed] 거부: localhost 가 아닌 호스트 {u.host!r}")
    name = (u.database or "").lower()
    if not ("e2e" in name or "test" in name):
        raise SystemExit(f"[seed] 거부: DB 이름에 e2e/test 가 없음 ({u.database!r})")


def target_url(db: str, base: str | None = None) -> str:
    raw = base or os.environ.get("DATABASE_URL") or "postgresql+psycopg://mal:mal_dev_pw@localhost:5432/postgres"
    for prefix in ("postgresql://", "postgres://"):
        if raw.startswith(prefix):
            raw = "postgresql+psycopg://" + raw[len(prefix):]
    url = make_url(raw).set(database=db)
    return url.render_as_string(hide_password=False)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="경마지 UI 확인용 로컬 시드 (합성 세계)")
    ap.add_argument("--db", required=True, help="대상 DB 이름 (e2e/test 포함, localhost)")
    ap.add_argument("--today", help="기준 오늘 YYYY-MM-DD (기본: 지금 KST 날짜)")
    args = ap.parse_args(argv)
    today = (date.fromisoformat(args.today) if args.today
             else datetime.now(KST).date())
    url = target_url(args.db)
    assert_safe_url(url)
    engine = create_engine(url, future=True)
    try:
        with engine.connect() as c:
            if not c.execute(text("SELECT to_regclass('mal.racing_form_editions') IS NOT NULL")
                             ).scalar():
                raise SystemExit(
                    "[seed] mal.racing_form_editions 없음 — tests/e2e/setup_db.sh 로 DB 를 만들 것")
        info = seed(engine, today)
    finally:
        engine.dispose()
    wd = "월화수목금토일"
    print(f"경마지 시드 완료 — DB {args.db} · 오늘 {today.isoformat()}({wd[today.weekday()]})")
    print(f"D  = {info.d.isoformat()}({wd[info.d.weekday()]}) — 서울 호 "
          f"{info.editions[f'{info.d}|서울']} · 제주 호 {info.editions[f'{info.d}|제주']} "
          f"(발행 {(info.d - timedelta(days=1)).isoformat()} 18:05 KST)")
    print(f"D′ = {info.d_prev.isoformat()}({wd[info.d_prev.weekday()]}) — 서울 호 "
          f"{info.editions[f'{info.d_prev}|서울']} (정산 확정 · 정정 공지 1건)")
    print(f"기준 r1 등록 {info.registered_at.isoformat()}")
    print("확인할 URL (web: DATABASE_URL=postgresql://<user>:<pw>@localhost:5432/"
          f"{args.db} npm run dev):")
    for u in info.urls:
        print(f"  {u}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
