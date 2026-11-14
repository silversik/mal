"""경마지 SQL provider · 저장소 · 잡 — 실제 PostgreSQL (`E2E_DATABASE_URL`) 에서.

`E2E_DATABASE_URL` 이 없으면 전부 skip. 운영 호스트·이름에 e2e/test 가 없는 DB 는 거부한다
(tests/e2e/conftest.py 와 같은 규칙).

- 합성 세계(마번 `RF99…`, 2099년 날짜)를 원천 테이블에 넣고 같은 세계를 FakeProvider 에도
  넣어, SqlProvider 13개 메서드의 결과와 build_edition(live) payload 가 같은지 대조한다
  (계약 §1 의미 일치).
- as-of: race_date ≥ H 인 행은 이력·집계·성적 반영일 어디에도 나오지 않는다.
- 저장: 잡 기본 배선(src.db.session_scope)으로 발행 → 036 CHECK 통과, picks = payload,
  payload_sha256 = SQL 재계산, summary = payload->'summary'. 재실행 0, D 결과 재확인,
  동시 insert_edition(스레드·별도 연결) → 한 벌·issue_no 빈틈/중복 없음.
- ensure_rule_set 해시 불일치 → RuntimeError. 공지 dedup · missed lock 재확인 · paused.
- 정산: 잠정 → D+1 13:00 확정 → 확정 뒤 결과 변경 = result_changed 공지 1회,
  확정 행 UPDATE 시도 없음.
- 정리: 모듈 시작·끝에 racing_form_* TRUNCATE (같은 트랜잭션에서 SET LOCAL GUC)
  + 합성 원천 행 DELETE.
  **테스트는 파일 순서대로 돈다** (뒤 테스트가 앞 테스트의 발행본을 쓴다).

실행:
  E2E_DATABASE_URL=postgresql+psycopg://mal:mal_dev_pw@localhost:5432/mal_e2e \\
    uv run pytest -q tests/test_racing_form_db_store.py
"""
from __future__ import annotations

import copy
import json
import os
import threading
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from racing_form_fakes import FakeProvider
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine, make_url
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

from src.jobs.racing_form_jobs import publish_racing_form, settle_racing_form
from src.racing_form import build, definitions, parse, payload, settle
from src.racing_form.build import NotPublishable
from src.racing_form.definitions import RuleSetDef
from src.racing_form.queries import SqlProvider, read_only_provider
from src.racing_form.store import SqlRepo, missed_key, paused_key

E2E_URL = os.environ.get("E2E_DATABASE_URL", "")

pytestmark = pytest.mark.skipif(
    not E2E_URL, reason="E2E_DATABASE_URL 미설정 — tests/e2e/README.md 참고")

KST = ZoneInfo("Asia/Seoul")
R1 = definitions.get("r1")

D = date(2099, 11, 15)
H = D - timedelta(days=1)
MEET = "서울"
YEAR_LO, YEAR_HI = date(2099, 1, 1), date(2099, 12, 31)
HORSE_PREFIX = "RF99"


def at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime.combine(d, time(hh, mm), tzinfo=KST)


PRE = at(H, 17)  # 동결 전 — 기준 정의 등록(출시)
FREEZE = at(H, 18)
DEADLINE = at(D, 8)  # min(08:00, 첫 발주 10:35 − 60분)
BATCH = at(H, 15)  # 출전표 배치 시각

TABLES = (
    "racing_form_rule_sets", "racing_form_editions", "racing_form_picks",
    "racing_form_race_outcomes", "racing_form_backtests", "racing_form_notices",
)


# ============================================================== 안전장치·연결


def _assert_safe_target(url: str) -> None:
    """tests/e2e/conftest.py 와 같은 규칙 — 운영 호스트, 이름에 e2e/test 없는 DB 거부."""
    u = make_url(url)
    if u.host and u.host.startswith("49.50.138."):
        pytest.exit("E2E_DATABASE_URL 이 운영 DB 를 가리킴 — 중단", returncode=2)
    name = (u.database or "").lower()
    if not ("e2e" in name or "test" in name) and os.environ.get("E2E_ALLOW_ANY_DB") != "1":
        pytest.exit(
            f"경마지 DB 테스트는 e2e/test DB 에서만 돈다 — DB 이름에 'e2e'/'test' 가 없으면 "
            f"거부 ({name!r}). 의도한 것이면 E2E_ALLOW_ANY_DB=1.",
            returncode=2,
        )


def tx_factory(engine: Engine) -> Callable[[], AbstractContextManager[Connection]]:
    """SqlRepo·read_only_provider 용 — 들어가면 새 트랜잭션, 정상 종료 commit."""

    @contextmanager
    def tx() -> Iterator[Connection]:
        with engine.begin() as c:
            yield c

    return tx


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    _assert_safe_target(E2E_URL)
    url = E2E_URL
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    eng = create_engine(url, future=True, pool_pre_ping=True, pool_size=8)
    try:
        with eng.connect() as c:
            if not c.execute(text("SELECT to_regclass('mal.racing_form_editions') IS NOT NULL")
                             ).scalar():
                pytest.exit(
                    "mal.racing_form_editions 없음 — 036 미적용. tests/e2e/setup_db.sh 로 "
                    "DB 를 다시 만들 것",
                    returncode=2,
                )
        yield eng
    finally:
        eng.dispose()


def q(engine: Engine, sql: str, **params: Any) -> list[dict[str, Any]]:
    with engine.connect() as c:
        return [dict(r) for r in c.execute(text(sql), params).mappings().all()]


def one(engine: Engine, sql: str, **params: Any) -> dict[str, Any]:
    rows = q(engine, sql, **params)
    assert len(rows) == 1, rows
    return rows[0]


def run_sql(engine: Engine, sql: str, rows: list[dict[str, Any]] | dict[str, Any]) -> None:
    with engine.begin() as c:
        if rows:
            c.execute(text(sql), rows)


# ============================================================== 합성 세계


JOCKEYS = ("가상기수가", "가상기수나", "가상기수다", "가상기수라", "가상기수마", "가상기수바",
           "가상기수사")
TRAINERS = ("가상조교갑", "가상조교을", "가상조교병")
D_HORSES = tuple(f"{HORSE_PREFIX}{r}{c:02d}" for r in (1, 2) for c in range(1, 7))
FILLERS = tuple(f"{HORSE_PREFIX}9{n:02d}" for n in range(1, 13))


def _jk_no(q_: int, k: int) -> str | None:
    """0: 0701/701 (정규화하면 같은 번호) · 1: 0702/0802 (동명이인) · 2: NULL 섞임 · 그 밖 고정."""
    if q_ == 0:
        return "0701" if k % 2 else "701"
    if q_ == 1:
        return "0702" if k % 2 else "0802"
    if q_ == 2:
        return "0703" if k % 2 else None
    return f"07{q_:02d}"


@dataclass
class World:
    horses: list[dict[str, Any]] = field(default_factory=list)
    races: list[dict[str, Any]] = field(default_factory=list)
    entries: list[dict[str, Any]] = field(default_factory=list)
    jockey_changes: list[dict[str, Any]] = field(default_factory=list)
    results: list[dict[str, Any]] = field(default_factory=list)
    rank_changes: list[dict[str, Any]] = field(default_factory=list)
    plans: list[dict[str, Any]] = field(default_factory=list)
    dividends: list[dict[str, Any]] = field(default_factory=list)

    def add_race(self, d: date, race_no: int, distance: int | None, *, meet: str = MEET,
                 grade: str | None = "국6", race_name: str | None = None,
                 start_time: str | None = None) -> None:
        self.races.append(dict(race_date=d, meet=meet, race_no=race_no, race_name=race_name,
                               distance=distance, grade=grade, track_type="더트",
                               start_time=start_time))

    def add_result(self, d: date, race_no: int, horse_no: str, rank: int | None,
                   time_: str | None, *, meet: str = MEET, jockey: str | None = None,
                   jk_no: str | None = None, trainer: str | None = None,
                   hr_rating: str | None = None, wg_budam: str | None = None,
                   chul_no: str | None = None, rc_dist: str | None = None,
                   track: str | None = "양호", tr_no: str | None = None) -> None:
        self.results.append(dict(race_date=d, meet=meet, race_no=race_no, horse_no=horse_no,
                                 rank=rank, time=time_, track=track, jockey=jockey, jk_no=jk_no,
                                 trainer=trainer, hr_rating=hr_rating, wg_budam=wg_budam,
                                 chul_no=chul_no, rc_dist=rc_dist, tr_no=tr_no))


def make_world() -> World:
    """2099-11-15(D) 서울 2경주 × 6두 + 이력 12주 × 2경주 × 7두.

    + as-of 경계(H−1·H) · stale · 기수 변경 · 등급 변동 · 다른 경마장 같은 경주번호.
    """
    w = World()
    for hn in D_HORSES:
        w.horses.append(dict(horse_no=hn, horse_name=f"가상말{hn[-3:]}", total=10))
    for hn in FILLERS:
        w.horses.append(dict(horse_no=hn, horse_name=f"채움말{hn[-2:]}", total=5))
    w.horses.append(dict(horse_no=f"{HORSE_PREFIX}107", horse_name="가상말107", total=3))

    # 이력 — H−7·7k (k=1..12, 모두 [H−90, H)) 서울 1R 1200m · 2R 1400m, 경주당 7두
    for k in range(1, 13):
        day = H - timedelta(days=7 * k)
        for r in (1, 2):
            dist = 1200 if r == 1 else 1400
            w.add_race(day, r, dist)
            base = (2 * k + r) % 12
            runners = [D_HORSES[(base + 5 * j) % 12] for j in range(5)]
            runners += [FILLERS[(k + r) % 12], FILLERS[(k + r + 5) % 12]]
            order = sorted(range(7), key=lambda i, k=k, r=r: ((k * 7 + r * 3 + i * 11) % 17, i))
            rank_of = {i: pos + 1 for pos, i in enumerate(order)}
            for i, hn in enumerate(runners):
                rank: int | None = rank_of[i]
                tm: str | None = f"{70 + rank + (r - 1) * 13}.{(k + i) % 10}0"
                if (k, r) == (3, 1) and rank == 7:  # 출주(착순 없음 — 기록 있음)
                    rank = None
                if (k, r) == (5, 2) and rank == 7:  # 미출주 (착순·기록 없음)
                    rank, tm = None, None
                qj = (i + k + r) % 7
                w.add_result(
                    day, r, hn, rank, tm,
                    jockey=JOCKEYS[qj], jk_no=_jk_no(qj, k), trainer=TRAINERS[(i + k) % 3],
                    hr_rating=str(55 + (k * 3 + i * 7 + r) % 25),
                    wg_budam="54.0" if (i + k) % 2 else "55.0",
                    chul_no=str(i + 1), rc_dist=str(dist),
                    track="건조" if k % 2 else "양호",
                )
    # H−1 (반영) · H (반영 안 됨 = as-of 경계) — RF99101 이 둘 다 출주
    w.add_race(H - timedelta(days=1), 3, 1200)
    w.add_result(H - timedelta(days=1), 3, D_HORSES[0], 2, "73.10", jockey=JOCKEYS[0],
                 jk_no="0701", trainer=TRAINERS[0], hr_rating="70", wg_budam="54.0",
                 chul_no="2", rc_dist="1200")
    w.add_result(H - timedelta(days=1), 3, FILLERS[0], 1, "72.90", jockey=JOCKEYS[3],
                 jk_no="0704", trainer=TRAINERS[1], hr_rating="66", wg_budam="55.0",
                 chul_no="1", rc_dist="1200")
    w.add_race(H, 1, 1200)
    w.add_result(H, 1, D_HORSES[0], 1, "70.00", jockey=JOCKEYS[0], jk_no="0999",
                 trainer=TRAINERS[0], hr_rating="99", wg_budam="50.0", chul_no="1",
                 rc_dist="1200")
    w.add_result(H, 1, FILLERS[1], 2, "70.50", jockey=JOCKEYS[1], jk_no="0998",
                 trainer=TRAINERS[1], hr_rating="60", wg_budam="54.0", chul_no="2",
                 rc_dist="1200")
    # 같은 날·같은 경주번호의 다른 경마장(부경) — field_size·Q3 가 경마장을 섞으면 어긋난다
    # (가상기수가 가 다른 번호 0555 로 타므로 섞이면 동명이인이 돼 버린다)
    for i, hn in enumerate(FILLERS[9:12]):
        w.add_result(H - timedelta(days=7), 1, hn, i + 1, f"7{i + 2}.00", meet="부경",
                     jockey=JOCKEYS[0], jk_no="0555", trainer=TRAINERS[0], chul_no=str(i + 1),
                     rc_dist="1200")
    w.add_race(H - timedelta(days=7), 1, 1200, meet="부경")
    # 이력 창 안 미해결 경주 (races 있음, 결과 없음)
    w.add_race(H - timedelta(days=3), 9, 1200)

    # D — 1R 1200m 국6 10:35 · 2R 1400m 가상배(L) 11:10
    w.add_race(D, 1, 1200, grade="국6", start_time="10:35")
    w.add_race(D, 2, 1400, grade="국5", race_name="가상배", start_time="11:10")
    w.plans.append(dict(meet=MEET, year=2099, race_date=D, race_no=2, race_name="가상배",
                        grade="L"))
    ratings = {1: [72, 68, 75, None, 66, None], 2: [80, 70, 65, 78, 74, 0]}
    for race_no in (1, 2):
        for c in range(1, 7):
            hn = f"{HORSE_PREFIX}{race_no}{c:02d}"
            w.entries.append(dict(
                race_date=D, meet=MEET, race_no=race_no, horse_no=hn, chul_no=c,
                horse_name=f"가상말{hn[-3:]}", jockey=JOCKEYS[(c + 2 * race_no - 1) % 7],
                trainer=TRAINERS[c % 3], age=str(3 + c % 3), sex="수" if c % 2 else "암",
                rating=ratings[race_no][c - 1],
                hr_rating="61" if (race_no, c) == (1, 4) else None,
                wg_budam="54.0" if c % 2 else "55.0", updated_at=BATCH))
    # 출전취소 잔존(stale) — 배치보다 3시간 오래된 행 → 제외 (1/7 이라 경고 없음)
    w.entries.append(dict(
        race_date=D, meet=MEET, race_no=1, horse_no=f"{HORSE_PREFIX}107", chul_no=7,
        horse_name="가상말107", jockey=JOCKEYS[0], trainer=TRAINERS[0], age="4", sex="수",
        rating=90, hr_rating=None, wg_budam="54.0", updated_at=at(H, 12)))
    # 기수 변경 — 같은 말에 두 행(옛 출전번호 12 · 정정된 2) → 최신 1건만, 다른 날 행은 무시
    w.jockey_changes += [
        dict(race_date=D, meet=MEET, race_no=2, chul_no=12, horse_no=D_HORSES[7],
             before=JOCKEYS[0], after=JOCKEYS[2], reason="구 기록", w_before="56.0",
             w_after="55.0", updated_at=at(H, 6, 25)),
        dict(race_date=D, meet=MEET, race_no=2, chul_no=2, horse_no=D_HORSES[7],
             before=JOCKEYS[5], after=JOCKEYS[6], reason="기수 부상", w_before="55.0",
             w_after="54.0", updated_at=at(H, 7)),
        dict(race_date=D + timedelta(days=7), meet=MEET, race_no=2, chul_no=2,
             horse_no=D_HORSES[7], before=JOCKEYS[6], after=JOCKEYS[1], reason="다음 주",
             w_before="54.0", w_after="53.0", updated_at=at(D, 7)),
    ]
    # 등급 변동 — 최신(≤ D) 1건: H−3 국5→국6 (마지막 출주 뒤 → 강급 후 첫 출전)
    w.rank_changes += [
        dict(horse_no=D_HORSES[2], st_date=H - timedelta(days=200), before="국4등급",
             after="국5등급"),
        dict(horse_no=D_HORSES[2], st_date=H - timedelta(days=3), before="국5등급",
             after="국6등급"),
        dict(horse_no=D_HORSES[2], st_date=D + timedelta(days=3), before="국6등급",
             after="국5등급"),
    ]
    return w


def to_fake(w: World) -> FakeProvider:
    """같은 세계의 FakeProvider (계약 §1 의미의 Python 기준 구현)."""
    p = FakeProvider()
    for r in w.races:
        plan = next((x for x in w.plans if (x["race_date"], x["race_no"], x["meet"])
                     == (r["race_date"], r["race_no"], r["meet"])), None)
        p.add_race(r["race_date"], r["meet"], r["race_no"], distance=r["distance"],
                   race_name=r["race_name"], grade=r["grade"], track_type=r["track_type"],
                   start_time=r["start_time"],
                   plan_name=plan["race_name"] if plan else None,
                   plan_grade=plan["grade"] if plan else None)
    for e in w.entries:
        jcs = [j for j in w.jockey_changes
               if (j["race_date"], j["race_no"], j["horse_no"])
               == (e["race_date"], e["race_no"], e["horse_no"])]
        jc = max(jcs, key=lambda j: j["updated_at"]) if jcs else None
        p.add_entry(e["race_date"], e["meet"], e["race_no"], e["horse_no"], e["chul_no"],
                    horse_name=e["horse_name"], jockey=e["jockey"], trainer=e["trainer"],
                    rating=e["rating"], raw_hr_rating=e["hr_rating"], wg_budam=e["wg_budam"],
                    age=e["age"], sex=e["sex"], updated_at=e["updated_at"],
                    jc_before=jc["before"] if jc else None,
                    jc_after=jc["after"] if jc else None,
                    jc_reason=jc["reason"] if jc else None,
                    jc_weight_before=jc["w_before"] if jc else None,
                    jc_weight_after=jc["w_after"] if jc else None)
    for r in w.results:
        row = p.add_result(r["race_date"], r["meet"], r["race_no"], r["horse_no"], r["rank"],
                           time=r["time"], chul_no=r["chul_no"], jockey=r["jockey"],
                           jk_no=r["jk_no"], trainer=r["trainer"], hr_rating=r["hr_rating"],
                           wg_budam=r["wg_budam"], track=r["track"])
        row.rc_dist = r["rc_dist"]
    for c in w.rank_changes:
        p.add_rank_change(c["horse_no"], c["st_date"], c["before"], c["after"])
    for h in w.horses:
        p.set_master(h["horse_no"], h["total"])
    for dv in w.dividends:
        p.add_dividend(dv["race_date"], dv["meet"], dv["race_no"], dv["chul_no_text"],
                       dv["win_rate"])
    return p


def _raw(**kv: Any) -> str:
    return json.dumps({k: v for k, v in kv.items() if v is not None}, ensure_ascii=False)


def seed(engine: Engine, w: World) -> None:
    run_sql(engine, "INSERT INTO horses (horse_no, horse_name, total_race_count) "
                    "VALUES (:horse_no, :horse_name, :total)", w.horses)
    run_sql(engine, """
        INSERT INTO races (race_date, meet, race_no, race_name, distance, grade, track_type,
                           start_time)
        VALUES (:race_date, :meet, :race_no, :race_name, :distance, :grade, :track_type,
                :start_time)""", w.races)
    run_sql(engine, """
        INSERT INTO race_entries (race_date, meet, race_no, horse_no, chul_no, horse_name,
                                  jockey_name, trainer_name, age, sex, rating, raw, updated_at)
        VALUES (:race_date, :meet, :race_no, :horse_no, :chul_no, :horse_name, :jockey,
                :trainer, :age, :sex, :rating, CAST(:raw AS jsonb), :updated_at)""",
            [{**e, "raw": _raw(hrRating=e["hr_rating"], wgBudam=e["wg_budam"])}
             for e in w.entries])
    run_sql(engine, """
        INSERT INTO jockey_changes (race_date, meet, race_no, chul_no, horse_no,
                                    jk_name_before, jk_name_after, weight_before, weight_after,
                                    reason, updated_at)
        VALUES (:race_date, :meet, :race_no, :chul_no, :horse_no, :before, :after,
                CAST(:w_before AS numeric), CAST(:w_after AS numeric), :reason, :updated_at)""",
            w.jockey_changes)
    seed_results(engine, w.results)
    run_sql(engine, "INSERT INTO horse_rank_changes (horse_no, st_date, before_rank, after_rank) "
                    "VALUES (:horse_no, :st_date, :before, :after)", w.rank_changes)
    run_sql(engine, "INSERT INTO race_plans (meet, year, race_date, race_no, race_name, grade) "
                    "VALUES (:meet, :year, :race_date, :race_no, :race_name, :grade)", w.plans)
    seed_dividends(engine, w.dividends)


def seed_results(engine: Engine, rows: list[dict[str, Any]]) -> None:
    run_sql(engine, """
        INSERT INTO race_results (horse_no, race_date, meet, race_no, track_condition, rank,
                                  record_time, jockey_name, trainer_name, raw)
        VALUES (:horse_no, :race_date, :meet, :race_no, :track, :rank,
                CAST(:time AS numeric), :jockey, :trainer, CAST(:raw AS jsonb))""",
            [{**r, "raw": _raw(jkNo=r["jk_no"], hrRating=r["hr_rating"], wgBudam=r["wg_budam"],
                              chulNo=r["chul_no"], rcDist=r["rc_dist"], trNo=r.get("tr_no"))}
             for r in rows])


def seed_dividends(engine: Engine, rows: list[dict[str, Any]]) -> None:
    run_sql(engine, """
        INSERT INTO race_dividends (race_date, meet, race_no, horse_no, win_rate)
        VALUES (:race_date, :meet, :race_no, :chul_no_text, CAST(:win_rate AS numeric))""",
            rows)


def cleanup(engine: Engine) -> None:
    """racing_form_* TRUNCATE (GUC 는 이 트랜잭션에서만) + 합성 원천 행 DELETE."""
    with engine.begin() as c:
        c.execute(text("SET LOCAL lock_timeout = '10s'"))
        c.execute(text("SET LOCAL mal.racing_form_allow_truncate = 'on'"))
        c.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        rng = {"lo": YEAR_LO, "hi": YEAR_HI}
        for table in ("race_dividends", "jockey_changes", "race_entries", "races"):
            c.execute(text(f"DELETE FROM {table} WHERE race_date BETWEEN :lo AND :hi"), rng)
        c.execute(text("DELETE FROM race_plans WHERE year = 2099"))
        like = {"p": f"{HORSE_PREFIX}%"}
        for table in ("horse_rank_changes", "race_results", "horses"):
            c.execute(text(f"DELETE FROM {table} WHERE horse_no LIKE :p"), like)


@pytest.fixture(scope="module")
def world(engine: Engine) -> Iterator[World]:
    w = make_world()
    cleanup(engine)
    seed(engine, w)
    try:
        yield w
    finally:
        cleanup(engine)


@pytest.fixture
def wired(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    """잡 기본 배선(src.db.session_scope)이 테스트 DB 를 보게 (e2e conftest 와 같은 방식)."""
    import src.db as db

    monkeypatch.setattr(db, "engine", engine)
    monkeypatch.setattr(
        db, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False, future=True))


def sql_repo(engine: Engine) -> SqlRepo:
    return SqlRepo(tx_factory(engine))


# ============================================================== provider


def test_provider_matches_fake_world(engine: Engine, world: World) -> None:
    """SqlProvider 13개 메서드 = FakeProvider (같은 세계) — 계약 §1 의미 일치."""
    fake = to_fake(world)
    meets = parse.VALID_MEETS
    horses = sorted({e["horse_no"] for e in world.entries})
    names_j = sorted(JOCKEYS)
    names_t = sorted(TRAINERS)

    def by(*keys: str) -> Callable[[Any], tuple[Any, ...]]:
        return lambda x: tuple(getattr(x, k) for k in keys)

    with read_only_provider(tx_factory(engine)) as sql:
        assert sql.calendar(D - timedelta(days=7), D + timedelta(days=7), meets) == \
            fake.calendar(D - timedelta(days=7), D + timedelta(days=7), meets)
        assert sorted(sql.entries(D, MEET), key=by("race_no", "horse_no")) == \
            sorted(fake.entries(D, MEET), key=by("race_no", "horse_no"))
        assert sql.race_meta(D, MEET) == fake.race_meta(D, MEET)
        key = by("horse_no", "race_date", "race_no")
        assert sorted(sql.history(horses, H), key=key) == sorted(fake.history(horses, H), key=key)
        name = by("name")  # SQL ORDER BY 는 DB collation — 비교는 Python 정렬로
        for window in (90, 30):
            assert sorted(sql.jockey_stats(names_j, MEET, H, window), key=name) == sorted(
                fake.jockey_stats(names_j, MEET, H, window), key=name)
            assert sorted(sql.trainer_stats(names_t, MEET, H, window), key=name) == sorted(
                fake.trainer_stats(names_t, MEET, H, window), key=name)
        assert sql.rank_changes(horses, D) == fake.rank_changes(horses, D)
        hn = by("horse_no")
        assert sorted(sql.masters(horses), key=hn) == sorted(fake.masters(horses), key=hn)
        assert sql.results_through(H) == fake.results_through(H) == H - timedelta(days=1)
        assert sql.results_exist(D, MEET) is fake.results_exist(D, MEET) is False
        assert sql.results_exist(H, MEET) is fake.results_exist(H, MEET) is True
        assert sql.unresolved_races(H, 14) == fake.unresolved_races(H, 14) == [
            (H - timedelta(days=3), MEET)]
        day = H - timedelta(days=7)
        assert sorted(sql.results(day, MEET), key=by("race_no", "horse_no")) == \
            sorted(fake.results(day, MEET), key=by("race_no", "horse_no"))
        assert sql.win_dividends(D, MEET) == fake.win_dividends(D, MEET) == []
        # 빈 입력은 SQL 없이 빈 결과
        assert sql.history([], H) == [] and sql.jockey_stats([], MEET, H, 90) == []


def test_history_and_stats_are_strictly_before_h(engine: Engine, world: World) -> None:
    hn = D_HORSES[0]
    assert one(engine, "SELECT COUNT(*) AS n FROM race_results WHERE horse_no = :h "
                       "AND race_date >= :d", h=hn, d=H)["n"] == 1  # H 행은 DB 에 있다
    with read_only_provider(tx_factory(engine)) as sql:
        rows = sql.history([hn], H)
        assert rows and max(r.race_date for r in rows) == H - timedelta(days=1)
        assert all(r.race_date < H for r in rows)
        last = max(rows, key=lambda r: (r.race_date, r.race_no))
        assert (last.rank, last.record_time, last.field_size, last.distance) == (2, "73.10", 2,
                                                                                 1200)
        # H 이후 기승은 집계에 없다 — 0999 번호(H 행)가 섞이면 동명이인이 돼 버린다
        (j0,) = sql.jockey_stats([JOCKEYS[0]], MEET, H, 90)
        assert j0.distinct_ids == 1
        assert j0.starts == 1 + sum(1 for r in world.results if r["jockey"] == JOCKEYS[0]
                                    and r["meet"] == MEET
                                    and r["race_date"] < H - timedelta(days=1)
                                    and (r["rank"] is not None or r["time"] is not None))
        # 기준일을 하루 뒤로 미루면 H 행이 들어온다 (SQL 의 < :h 가 실제로 경계)
        later = sql.history([hn], D)
        assert max(r.race_date for r in later) == H


def test_entries_jockey_change_latest_without_duplicates(engine: Engine, world: World) -> None:
    with read_only_provider(tx_factory(engine)) as sql:
        rows = sql.entries(D, MEET)
    keys = [(r.race_no, r.horse_no) for r in rows]
    assert len(keys) == len(set(keys)) == 13  # 12 + stale 1, LATERAL 로 늘어나지 않음
    assert {r.batch_at for r in rows} == {BATCH}
    jc = {r.horse_no: r for r in rows if r.has_jockey_change}
    assert list(jc) == [D_HORSES[7]]
    r = jc[D_HORSES[7]]
    assert (r.jc_before, r.jc_after, r.jc_reason, r.jc_weight_before, r.jc_weight_after) == (
        JOCKEYS[5], JOCKEYS[6], "기수 부상", "55.0", "54.0")


def test_homonym_counts_and_trainer_ids(engine: Engine, world: World) -> None:
    with read_only_provider(tx_factory(engine)) as sql:
        stats = {s.name: s for s in sql.jockey_stats(list(JOCKEYS), MEET, H, 90)}
    assert stats[JOCKEYS[0]].distinct_ids == 1  # 0701 ≡ 701
    assert stats[JOCKEYS[1]].distinct_ids == 2  # 0702 · 0802 → 동명이인
    assert stats[JOCKEYS[2]].distinct_ids == 1  # NULL 섞임은 동명이인 아님
    assert all(s.starts >= 20 for s in stats.values())
    # 조교사 번호(trNo)도 같은 방식으로 센다 — 다른 경마장(제주) 행은 서울 집계에 섞이지 않는다
    day = date(2099, 3, 1)
    rows = [dict(race_date=day, meet="제주", race_no=1, horse_no=FILLERS[i], rank=i + 1,
                 time="80.00", track="양호", jockey=None, jk_no=None, trainer="가상조교갑",
                 hr_rating=None, wg_budam=None, chul_no=str(i + 1), rc_dist="1000",
                 tr_no=tr)
            for i, tr in enumerate(["0901", "901", "0902"])]
    seed_results(engine, rows)
    with read_only_provider(tx_factory(engine)) as sql:
        (t,) = sql.trainer_stats(["가상조교갑"], "제주", date(2099, 3, 10), 90)
        assert (t.starts, t.wins, t.top3, t.distinct_ids) == (3, 1, 3, 2)
        seoul = {s.name: s for s in sql.trainer_stats(list(TRAINERS), MEET, H, 90)}
        assert seoul["가상조교갑"].distinct_ids == 0  # 서울 이력에는 trNo 가 없다


def test_calendar_first_post_is_parsed_time(engine: Engine, world: World) -> None:
    """start_time 이 '9:50' 처럼 앞자리 0 이 없어도 가장 이른 시각을 'HH:MM' 으로."""
    day = date(2099, 12, 20)
    w = World()
    w.add_race(day, 1, 1200, meet="부경", start_time="10:35")
    w.add_race(day, 2, 1200, meet="부경", start_time=" 9:50 ")
    w.add_race(day, 3, 1200, meet="부경", start_time="")
    w.add_race(day, 4, 1200, meet="부경", start_time="8:10")  # 출전표 없는 경주 → 달력 밖
    run_sql(engine, """
        INSERT INTO races (race_date, meet, race_no, race_name, distance, grade, track_type,
                           start_time)
        VALUES (:race_date, :meet, :race_no, :race_name, :distance, :grade, :track_type,
                :start_time)""", w.races)
    run_sql(engine, """
        INSERT INTO race_entries (race_date, meet, race_no, horse_no, chul_no, updated_at)
        VALUES (:d, '부경', :race_no, :horse_no, 1, :ts)""",
            [dict(d=day, race_no=n, horse_no=FILLERS[n], ts=BATCH) for n in (1, 2, 3)])
    with read_only_provider(tx_factory(engine)) as sql:
        (row,) = sql.calendar(day, day, parse.VALID_MEETS)
    assert (row.race_date, row.meet, row.race_count, row.first_post) == (day, "부경", 3, "09:50")


# ============================================================== 발행 (잡 기본 배선)


def test_sql_build_equals_fake_build(engine: Engine, world: World) -> None:
    with read_only_provider(tx_factory(engine)) as sql:
        got = build.build_edition(sql, D, MEET, FREEZE, R1, mode="live", enforce_window=True)
    want = build.build_edition(to_fake(world), D, MEET, FREEZE, R1, mode="live",
                               enforce_window=True)
    assert payload.canonical_json(got.payload) == payload.canonical_json(want.payload)
    assert got.picks == want.picks and got.meta == want.meta and got.warnings == want.warnings
    assert got.meta["results_through"] == H - timedelta(days=1)
    unresolved = H - timedelta(days=3)
    assert got.payload["edition"]["warnings"] == [f"unresolved_history:{unresolved}|서울"]
    # 세계가 기준을 실제로 태우는지 (빈 예상끼리 같은 것이 아님)
    for race in got.payload["races"]:
        assert {r["key"]: r["status"] for r in race["rules"]} == {
            "rating": "picked", "form": "picked", "course": "picked", "jockey": "picked"}
    assert got.payload["races"][1]["stakes"] == {"name": "가상배", "grade": "L"}
    kinds = {b["kind"] for race in got.payload["races"] for rn in race["runners"]
             for b in rn["badges"]}
    assert {"jockey_change", "class_change"} <= kinds


def test_publish_job_default_wiring_inserts_edition(engine: Engine, world: World,
                                                    wired: None) -> None:
    assert publish_racing_form(PRE) == (0, [])  # 기준 등록만
    assert publish_racing_form(FREEZE) == (1, [])
    assert publish_racing_form(FREEZE + timedelta(hours=1)) == (0, [])
    assert publish_racing_form(DEADLINE) == (0, [])  # 발행됨 → missed 없음

    want = build.build_edition(to_fake(world), D, MEET, FREEZE, R1, mode="live")
    ed = one(engine, """
        SELECT id, issue_no, rules_version, schema_version, history_before, results_through,
               entries_batch_at, freeze_at, deadline_at, published_at, race_count, runner_count,
               payload, summary,
               summary = payload -> 'summary' AS summary_ok,
               payload_sha256 = encode(sha256(convert_to(payload::text, 'UTF8')), 'hex')
                   AS sha_ok
          FROM racing_form_editions WHERE race_date = :d AND meet = :m""", d=D, m=MEET)
    assert ed["sha_ok"] and ed["summary_ok"]
    assert ed["payload"] == json.loads(payload.canonical_json(want.payload))
    assert ed["summary"] == want.payload["summary"]
    assert (ed["issue_no"], ed["rules_version"], ed["schema_version"]) == (1, "r1", 1)
    assert (ed["history_before"], ed["results_through"]) == (H, H - timedelta(days=1))
    assert ed["entries_batch_at"] == BATCH
    assert (ed["freeze_at"], ed["deadline_at"], ed["published_at"]) == (FREEZE, DEADLINE, FREEZE)
    assert (ed["race_count"], ed["runner_count"]) == (2, 12)
    picks = q(engine, """
        SELECT race_date, meet, race_no, rule_key, rule_version, mark, horse_no, chul_no,
               horse_name, votes, reason
          FROM racing_form_picks WHERE edition_id = :e ORDER BY id""", e=ed["id"])
    assert picks == want.picks
    assert any(p["rule_key"] == "consensus" for p in picks)
    rs = one(engine, "SELECT definition_sha256, registered_at FROM racing_form_rule_sets "
                     "WHERE rules_version = 'r1'")
    assert rs == {"definition_sha256": definitions.definition_sha256(R1), "registered_at": PRE}
    assert q(engine, "SELECT kind FROM racing_form_notices") == []


def mini_build(d: date, meet: str, now: datetime | None = None) -> build.BuildResult:
    """출전마 5두·레이팅만 있는 작은 호 (FakeProvider, live) — 저장 경로 시험용."""
    p = FakeProvider(entries_updated_at=at(d - timedelta(days=1), 15))
    p.add_race(d, meet, 1, distance=1200, start_time="10:30")
    for c in range(1, 6):
        p.add_entry(d, meet, 1, f"{HORSE_PREFIX}M{c:02d}", c, rating=60 + c)
    return build.build_edition(p, d, meet, now or at(d - timedelta(days=1), 18, 5), R1,
                               mode="live", enforce_window=True)


def test_insert_edition_rechecks_results_and_live_only(engine: Engine, world: World) -> None:
    repo = sql_repo(engine)
    repo.ensure_rule_set(R1, PRE)
    d = date(2099, 10, 4)
    res = mini_build(d, "제주")
    seed_results(engine, [dict(race_date=d, meet="제주", race_no=1, horse_no=FILLERS[0], rank=1,
                               time="61.00", track="양호", jockey=None, jk_no=None,
                               trainer=None, hr_rating=None, wg_budam=None, chul_no="1",
                               rc_dist="1000")])
    with pytest.raises(NotPublishable) as ei:
        repo.insert_edition(res, at(d - timedelta(days=1), 18, 5))
    assert ei.value.code == "results_present"
    assert q(engine, "SELECT id FROM racing_form_editions WHERE race_date = :d", d=d) == []
    # replay·backtest 빌드는 저장하지 않는다 (발행 경로는 잡 하나)
    replay = replace(res, meta={**res.meta, "mode": "replay"})
    with pytest.raises(ValueError, match="live"):
        repo.insert_edition(replay, at(d - timedelta(days=1), 18, 5))
    with pytest.raises(ValueError):
        repo.insert_edition(res, at(d - timedelta(days=1), 18, 5).replace(tzinfo=None))


def test_insert_edition_window_check_is_db_enforced(engine: Engine, world: World) -> None:
    """마감 뒤 published_at 은 036 ck_rf_window 가 거부 (잡의 창 검사가 뚫려도 DB 가 막는다)."""
    repo = sql_repo(engine)
    d = date(2099, 10, 11)
    res = mini_build(d, "제주")
    with pytest.raises(DBAPIError) as ei:
        repo.insert_edition(res, at(d, 8))
    assert ei.value.orig.diag.constraint_name == "ck_rf_window"
    assert q(engine, "SELECT id FROM racing_form_editions WHERE race_date = :d", d=d) == []


def test_concurrent_insert_edition_one_edition_no_issue_gaps(engine: Engine,
                                                             world: World) -> None:
    """스레드 5개(별도 연결)가 동시에 저장.

    같은 호 2번은 한 벌만, issue_no 는 1..4 로 빈틈·중복 없음 (advisory lock + 재확인).
    """
    repo = sql_repo(engine)
    repo.ensure_rule_set(R1, PRE)
    meet = "제주"
    days = [date(2099, 6, 7) + timedelta(days=7 * i) for i in range(4)]
    builds = {d: mini_build(d, meet) for d in days}
    jobs_ = [(d, builds[d]) for d in days] + [(days[0], builds[days[0]])]
    barrier = threading.Barrier(len(jobs_))
    out: list[Any] = [None] * len(jobs_)

    def work(i: int, d: date, res: build.BuildResult) -> None:
        try:
            barrier.wait(timeout=30)
            out[i] = repo.insert_edition(res, at(d - timedelta(days=1), 18, 5))
        except Exception as e:  # noqa: BLE001 — 메인 스레드에서 단언
            out[i] = e

    threads = [threading.Thread(target=work, args=(i, d, r)) for i, (d, r) in enumerate(jobs_)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    assert not any(isinstance(x, Exception) for x in out), out
    assert sorted(x > 0 for x in out) == [False, True, True, True, True]
    assert out[0] == 0 or out[4] == 0  # 같은 호를 늦게 잡은 쪽이 0
    rows = q(engine, "SELECT race_date, issue_no FROM racing_form_editions WHERE meet = :m "
                     "ORDER BY issue_no", m=meet)
    assert [r["issue_no"] for r in rows] == [1, 2, 3, 4]
    assert sorted(r["race_date"] for r in rows) == days
    ids = [x for x in out if x]
    picks = q(engine, "SELECT edition_id, COUNT(*) AS n FROM racing_form_picks "
                      "WHERE edition_id = ANY(:ids) GROUP BY edition_id", ids=ids)
    assert {r["edition_id"]: r["n"] for r in picks} == {
        i: len(builds[days[0]].picks) for i in ids}


def test_ensure_rule_set_mismatch_raises(engine: Engine, world: World) -> None:
    repo = sql_repo(engine)
    assert repo.ensure_rule_set(R1, FREEZE) is False  # 이미 등록 (registered_at 그대로)
    params = copy.deepcopy(R1.params)
    params["field"]["min_active"] = 6
    changed = RuleSetDef(version="r1", rules=R1.rules,
                         backtest_extra_rules=R1.backtest_extra_rules, params=params)
    with pytest.raises(RuntimeError, match="정의 해시"):
        repo.ensure_rule_set(changed, FREEZE)
    assert one(engine, "SELECT definition_sha256, registered_at FROM racing_form_rule_sets "
                       "WHERE rules_version = 'r1'") == {
        "definition_sha256": definitions.definition_sha256(R1), "registered_at": PRE}
    assert repo.launch_at() == PRE


def test_notices_dedup_missed_recheck_and_paused(engine: Engine, world: World) -> None:
    repo = sql_repo(engine)
    d2 = date(2099, 11, 22)
    # publish_failed — 같은 사유는 한 번, 다른 사유는 새로. 마지막 사유를 돌려준다
    assert repo.record_publish_failure(d2, "부경", "no_entries", at(d2, 1)) is True
    assert repo.record_publish_failure(d2, "부경", "no_entries", at(d2, 2)) is False
    assert repo.record_publish_failure(d2, "부경", "error:KeyError", at(d2, 3),
                                       detail={"message": "x"}) is True
    assert repo.last_publish_failure(d2, "부경") == "error:KeyError"
    assert repo.last_publish_failure(d2, "서울") is None
    pf = q(engine, "SELECT dedup_key, detail, edition_id, source FROM racing_form_notices "
                   "WHERE kind = 'publish_failed' ORDER BY id")
    assert [r["dedup_key"] for r in pf] == ["publish_failed|2099-11-22|부경|no_entries",
                                            "publish_failed|2099-11-22|부경|error:KeyError"]
    assert pf[1]["detail"] == {"message": "x", "reason_code": "error:KeyError"}
    assert {r["edition_id"] for r in pf} == {None} and {r["source"] for r in pf} == {"job"}
    # missed — 발행본이 있으면 (lock 안 재확인) 기록하지 않는다, 없으면 한 번만
    assert repo.record_missed(D, MEET, at(D, 8), public_text="x") is False
    text_ = "이번 호는 발행하지 않았습니다 — 출전표 자료를 확인하지 못했습니다"
    assert repo.record_missed(d2, "부경", at(d2, 8), public_text=text_,
                              detail={"reason_code": "no_entries"}) is True
    assert repo.record_missed(d2, "부경", at(d2, 9), public_text=text_) is False
    (m,) = q(engine, "SELECT * FROM racing_form_notices WHERE kind = 'missed'")
    assert (m["dedup_key"], m["edition_id"], m["public_text"], m["noticed_at"]) == (
        missed_key(d2, "부경"), None, text_, at(d2, 8))
    # paused — 기간 [race_date, until], meet NULL = 전체
    start, until = date(2099, 12, 4), date(2099, 12, 6)
    assert repo.record_notice(kind="paused", race_date=start, meet=None,
                              public_text="이번 주는 쉽니다 — 점검",
                              dedup_key=paused_key(start, None, until), noticed_at=at(start, 9),
                              detail={"until": until.isoformat()}, source="operator") is True
    assert repo.is_paused(start, "서울") and repo.is_paused(until, "제주")
    assert not repo.is_paused(start - timedelta(days=1), "서울")
    assert not repo.is_paused(until + timedelta(days=1), "서울")
    assert repo.record_notice(kind="paused", race_date=until + timedelta(days=7), meet="부경",
                              public_text="쉼", noticed_at=at(until, 9),
                              dedup_key=paused_key(until + timedelta(days=7), "부경",
                                                   until + timedelta(days=7)),
                              detail={"until": (until + timedelta(days=7)).isoformat()},
                              source="operator")
    assert repo.is_paused(until + timedelta(days=7), "부경")
    assert not repo.is_paused(until + timedelta(days=7), "서울")
    # CHECK 위반은 DB 에 가기 전에 ValueError
    with pytest.raises(ValueError):
        repo.record_notice(kind="missed", race_date=d2, meet="부경", public_text="x",
                           dedup_key="x|1", noticed_at=at(d2, 8), edition_id=1)
    with pytest.raises(ValueError):
        repo.record_notice(kind="paused", race_date=d2, meet=None, public_text="x",
                           dedup_key="x|2", noticed_at=at(d2, 8), detail={"until": "20991222"})
    with pytest.raises(ValueError):  # 계약 §7 — paused·publish_failed 는 edition_id NULL
        repo.record_notice(kind="paused", race_date=d2, meet=None, public_text="x",
                           dedup_key="x|3", noticed_at=at(d2, 8), edition_id=1,
                           detail={"until": "2099-12-22"})
    with pytest.raises(ValueError):
        repo.record_notice(kind="result_changed", race_date=d2, meet="부경", public_text="x",
                           dedup_key="x|4", noticed_at=at(d2, 8))
    assert q(engine, "SELECT id FROM racing_form_notices WHERE dedup_key LIKE 'x|%'") == []


# ============================================================== 정산


def d_results(order_1: list[int], order_2: list[int]) -> list[dict[str, Any]]:
    """D 결과 — order = 도착 순서의 출전번호."""
    rows = []
    for race_no, order in ((1, order_1), (2, order_2)):
        for rank, chul in enumerate(order, start=1):
            rows.append(dict(race_date=D, meet=MEET, race_no=race_no,
                             horse_no=f"{HORSE_PREFIX}{race_no}{chul:02d}", rank=rank,
                             time=f"{71 + rank}.20", track="양호", jockey=None, jk_no=None,
                             trainer=None, hr_rating=None, wg_budam=None, chul_no=str(chul),
                             rc_dist=None))
    return rows


def outcome_rows(engine: Engine, edition_id: int) -> dict[int, dict[str, Any]]:
    rows = q(engine, "SELECT * FROM racing_form_race_outcomes WHERE edition_id = :e",
             e=edition_id)
    return {r["race_no"]: r for r in rows}


def test_settle_job_provisional_final_and_result_changed(engine: Engine, world: World,
                                                         wired: None) -> None:
    (ed,) = q(engine, "SELECT id, payload FROM racing_form_editions "
                      "WHERE race_date = :d AND meet = :m", d=D, m=MEET)
    eid = ed["id"]
    refs = [r for r in sql_repo(engine).editions_for_settlement(D, D) if r.id == eid]
    assert [dict(r) for r in refs[0].races] == [
        {"race_no": race["race_no"],
         "runners": [{"horse_no": x["horse_no"], "chul_no": x["chul_no"]}
                     for x in race["runners"]]}
        for race in ed["payload"]["races"]]

    assert settle_racing_form(at(D, 10, 15)) == (0, [])  # 결과 전 — 대기
    results = d_results([3, 1, 2, 5, 4, 6], [6, 2, 1, 3, 5, 4])
    seed_results(engine, results)
    divs = [dict(race_date=D, meet=MEET, race_no=1, chul_no_text=c, win_rate=v)
            for c, v in (("3", "2.4"), ("1", "3.1"), ("2", "3.1"))]
    seed_dividends(engine, divs)
    s1 = at(D, 15, 15)
    assert settle_racing_form(s1) == (2, [])
    rows = outcome_rows(engine, eid)
    fake = to_fake(world)
    for r in results:
        fake.add_result(D, MEET, r["race_no"], r["horse_no"], r["rank"], time=r["time"],
                        chul_no=r["chul_no"])
    for dv in divs:
        fake.add_dividend(D, MEET, 1, dv["chul_no_text"], dv["win_rate"])
    for race in ed["payload"]["races"]:
        want = settle.settle_race(race, fake.results(D, MEET), fake.win_dividends(D, MEET), s1,
                                  D, R1)
        got = rows[race["race_no"]]
        assert {k: got[k] for k in want.to_row()} == want.to_row()
        assert (got["is_final"], got["finalized_at"], got["first_settled_at"],
                got["settled_at"], got["race_date"]) == (False, None, s1, s1, D)
    assert rows[1]["favorites"] == ["RF99103"] and rows[1]["pop_ranks"] == {
        "RF99103": 1, "RF99101": 2, "RF99102": 2}

    assert settle_racing_form(at(D, 22, 45)) == (0, [])  # 같은 결과 — 쓰지 않음
    fin = at(D + timedelta(days=1), 13, 15)
    assert settle_racing_form(fin) == (2, [])  # D+1 13:00 이후 첫 실행 → 확정
    rows = outcome_rows(engine, eid)
    assert all(r["is_final"] and r["finalized_at"] == fin and r["settled_at"] == s1
               for r in rows.values())
    assert settle_racing_form(fin + timedelta(minutes=30)) == (0, [])

    # 확정 뒤 KRA 정정 — 1R 1착·2착이 뒤바뀜 → UPDATE 하지 않고 result_changed 1회
    with engine.begin() as c:
        c.execute(text("UPDATE race_results SET rank = 3 - rank WHERE race_date = :d "
                       "AND meet = :m AND race_no = 1 AND rank IN (1, 2)"), {"d": D, "m": MEET})
    before = outcome_rows(engine, eid)
    changed_at = at(D + timedelta(days=1), 14, 15)
    count, failures = settle_racing_form(changed_at)
    assert count == 0 and len(failures) == 1
    assert "1R 정산 확정 뒤 결과 변경 (result_changed" in failures[0]
    assert outcome_rows(engine, eid) == before  # 확정 정산은 그대로
    (n,) = q(engine, "SELECT * FROM racing_form_notices WHERE kind = 'result_changed'")
    assert (n["edition_id"], n["race_date"], n["meet"], n["source"], n["noticed_at"]) == (
        eid, D, MEET, "job", changed_at)
    assert n["dedup_key"].startswith(f"result_changed|{eid}|1|")
    assert n["detail"]["before"]["winners"] == ["RF99103"]
    assert n["detail"]["after"]["winners"] == ["RF99101"]
    assert settle_racing_form(changed_at + timedelta(minutes=30)) == (0, [])  # dedup
    assert len(q(engine, "SELECT id FROM racing_form_notices WHERE kind = 'result_changed'")) == 1
    # 확정 행은 저장소 UPDATE 가 건드리지 않고(False), 직접 UPDATE 는 트리거가 거부한다
    repo = sql_repo(engine)
    out = settle.settle_race(ed["payload"]["races"][0], fake.results(D, MEET), [], changed_at,
                             D, R1)
    assert repo.update_outcome(eid, out, changed_at, final=True) is False
    assert repo.finalize_outcome(eid, 1, changed_at) is False
    assert repo.insert_outcome(eid, D, out, changed_at, final=True) is False
    with pytest.raises(DBAPIError) as ei, engine.begin() as c:
        c.execute(text("UPDATE racing_form_race_outcomes SET settled_at = :t "
                       "WHERE edition_id = :e AND race_no = 1"), {"t": changed_at, "e": eid})
    assert ei.value.orig.sqlstate == "P0001"
    assert outcome_rows(engine, eid) == before
    assert repo.get_outcome(eid, 1).is_final and repo.get_outcome(eid, 99) is None


def test_provider_session_is_read_only(engine: Engine, world: World) -> None:
    with pytest.raises(DBAPIError) as ei, read_only_provider(tx_factory(engine)) as sql:
        assert isinstance(sql, SqlProvider)
        sql.conn.execute(text("UPDATE races SET grade = grade WHERE race_date = :d"), {"d": D})
    assert ei.value.orig.sqlstate == "25006"  # read_only_sql_transaction
