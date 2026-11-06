"""E2E replay 공용 fixture — `E2E_DATABASE_URL` 이 없으면 tests/e2e 전체가 skip.

seam (모두 module scope 로 설치, 끝나면 원복):
- DB: `src.db.engine` / `SessionLocal` 을 E2E_DATABASE_URL 엔진으로 교체 (src.config 는
  이미 import 시점에 tests/conftest.py 의 더미 DATABASE_URL 로 엔진을 만들었으므로).
- HTTP: `httpx.Client` 를 MockTransport 주입 서브클래스로 교체 → 모든 클라이언트
  (kra_base / kma_asos / naver_news / youtube / race_today_html) 가 FakeWeb 로 간다.
- 시계: src.* 모듈의 `date` / `datetime` 이름을 가짜 KST 시계 기반 클래스로 교체
  (프로세스 TZ=Asia/Seoul 인 prod 컨테이너와 같은 의미의 date.today()).
- 대시보드: `src.monitoring.dash` 를 호출 기록기로 교체 (crawler_core 미설치면 스텁 주입).
- 스케줄러: `src.scheduler_main.main()` 을 가짜 BlockingScheduler 로 돌려 add_job 목록과
  TRIGGER_JOBS(= _trigger_poll 이 poll_and_dispatch 에 넘기는 dict) 를 그대로 수집.
"""
from __future__ import annotations

import dataclasses
import datetime as _dt
import os
import sys
import types
from dataclasses import dataclass, field
from typing import Any

import pytest

E2E_URL = os.environ.get("E2E_DATABASE_URL", "")

# ---- crawler_core 가 없는 환경(sibling 레포 미설치)에서도 src.monitoring import 가능하게.
try:  # pragma: no cover - 환경 의존
    from crawler_core import client as _real_dash  # noqa: F401
except Exception:  # noqa: BLE001
    _pkg = types.ModuleType("crawler_core")
    _cli = types.ModuleType("crawler_core.client")

    def _noop(*_a: Any, **_k: Any) -> None:
        return None

    for _n in ("safe_register", "safe_start_run", "safe_finish_run", "poll_and_dispatch"):
        setattr(_cli, _n, _noop)
    _pkg.client = _cli  # type: ignore[attr-defined]
    sys.modules.setdefault("crawler_core", _pkg)
    sys.modules.setdefault("crawler_core.client", _cli)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if E2E_URL:
        return
    skip = pytest.mark.skip(reason="E2E_DATABASE_URL 미설정 — tests/e2e/README.md 참고")
    for item in items:
        if "tests/e2e/" in str(item.fspath).replace(os.sep, "/"):
            item.add_marker(skip)


# ============================================================== dashboard recorder


@dataclass
class DashRecorder:
    calls: list[tuple[str, tuple, dict]] = field(default_factory=list)
    _seq: int = 0

    def safe_register(self, **kw: Any) -> None:
        self.calls.append(("register", (), kw))

    def safe_start_run(self, job_key: str) -> str:
        self._seq += 1
        run_id = f"run-{self._seq}"
        self.calls.append(("start", (job_key, run_id), {}))
        return run_id

    def safe_finish_run(self, run_id: str, **kw: Any) -> None:
        self.calls.append(("finish", (run_id,), kw))

    def poll_and_dispatch(self, jobs: dict) -> None:  # scheduler_main 의 trigger poll 용
        self.calls.append(("poll", (jobs,), {}))

    def runs(self) -> list[dict[str, Any]]:
        """start/finish 쌍 → [{job_key, status, rows, error}]"""
        started = {c[1][1]: c[1][0] for c in self.calls if c[0] == "start"}
        out = []
        for name, args, kw in self.calls:
            if name == "finish":
                out.append({"job_key": started.get(args[0]), "status": kw.get("status"),
                            "rows": kw.get("rows_upserted"), "error": kw.get("error_message"),
                            "job_key_kw": kw.get("job_key")})
        return out


# ===================================================================== fake clock


def make_fake_time(clock: Any) -> tuple[type, type]:
    """clock.now (aware KST) 를 읽는 date/datetime 서브클래스 쌍."""

    class FakeDate(_dt.date):
        @classmethod
        def today(cls) -> _dt.date:  # type: ignore[override]
            n = clock.now
            return _dt.date(n.year, n.month, n.day)

    class FakeDateTime(_dt.datetime):
        @classmethod
        def now(cls, tz: _dt.tzinfo | None = None) -> _dt.datetime:  # type: ignore[override]
            if tz is None:  # 프로세스 TZ=Asia/Seoul 가정 → naive KST
                return clock.now.replace(tzinfo=None)
            return clock.now.astimezone(tz)

        @classmethod
        def utcnow(cls) -> _dt.datetime:  # type: ignore[override]
            return clock.now.astimezone(_dt.UTC).replace(tzinfo=None)

        @classmethod
        def today(cls) -> _dt.datetime:  # type: ignore[override]
            return cls.now()

    return FakeDate, FakeDateTime


def libpq_url(url: str) -> str:
    for prefix in ("postgresql+psycopg://", "postgres+psycopg://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    return url


def _assert_safe_target(url: str) -> None:
    from sqlalchemy.engine import make_url

    u = make_url(url)
    if u.host and u.host.startswith("49.50.138."):
        pytest.exit("E2E_DATABASE_URL 이 운영 DB 를 가리킴 — 중단", returncode=2)
    name = (u.database or "").lower()
    if not ("e2e" in name or "test" in name) and os.environ.get("E2E_ALLOW_ANY_DB") != "1":
        pytest.exit(
            f"E2E 는 대상 DB 의 데이터 테이블을 TRUNCATE 한다 — DB 이름에 'e2e'/'test' 가 "
            f"없으면 거부 ({name!r}). 의도한 것이면 E2E_ALLOW_ANY_DB=1.",
            returncode=2,
        )


# ========================================================================= env


@dataclass
class E2EEnv:
    world: Any
    clock: Any
    web: Any
    dash: DashRecorder
    engine: Any
    jobs: dict[str, Any]  # scheduler_main 이 add_job 한 id → 함수 (trigger_poll 제외)
    trigger_jobs: dict[str, Any]  # scheduler_main 의 TRIGGER_JOBS
    triggers: dict[str, Any]  # id → APScheduler trigger 객체
    results: dict[str, list[Any]] = field(default_factory=dict)  # job id → 반환값들
    scheduler_timezone: str = ""
    registered: list[str] = field(default_factory=list)  # 대시보드 register 된 job_key

    # --------------------------------------------------------------- run

    def run(self, job_id: str, when: _dt.date, hh: int, mm: int = 0) -> int:
        """가짜 시계를 맞추고 scheduler 에 등록된 함수 그대로 1회 실행 → 반환값.

        @track_job 이 대시보드에 success 로 보고했는지(rows = 반환값), 예기치 않은
        HTTP 요청이 없었는지까지 확인한다.
        """
        self.clock.set(when, hh, mm)
        self.web.reset()
        self.dash.calls.clear()
        fn = self.jobs[job_id]
        try:
            result = fn()
        except Exception as e:
            raise AssertionError(
                f"{job_id} @ {self.clock.now.isoformat()} 실패: {type(e).__name__}: {e}\n"
                f"dash={self.dash.runs()}\nunexpected={self.web.unexpected}"
            ) from e
        runs = self.dash.runs()
        assert [r["job_key"] for r in runs] == [job_id], runs
        assert runs[0]["status"] == "success", runs
        assert runs[0]["rows"] == result, runs
        assert not self.web.unexpected, self.web.unexpected
        self.results.setdefault(job_id, []).append(result)
        return result

    # --------------------------------------------------------------- SQL

    def q(self, sql: str, **params: Any) -> list[dict[str, Any]]:
        from sqlalchemy import text

        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(text(sql), params).mappings().all()]

    def one(self, sql: str, **params: Any) -> dict[str, Any]:
        rows = self.q(sql, **params)
        assert len(rows) == 1, rows
        return rows[0]

    def web_query(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        """web/src/lib/*.ts 의 node-pg SQL($1..$n) 을 그대로 실행 (psycopg 로 바꿔 끼움)."""
        import re

        import psycopg
        from psycopg.rows import dict_row

        s = sql.replace("%", "%%")
        s = re.sub(r"\$(\d+)", lambda m: f"%(p{m.group(1)})s", s)
        args = {f"p{i + 1}": v for i, v in enumerate(params)}
        with psycopg.connect(libpq_url(E2E_URL), row_factory=dict_row) as c:
            return c.execute(s, args).fetchall()


_DATA_TABLES = (
    "notifications", "user_favorite_horses", "user_accounts", "users",
    "race_results", "race_entries", "race_dividends", "race_combo_dividends",
    "race_pool_sales", "race_corners", "races", "horse_ratings", "horse_rank_changes",
    "jockey_changes", "horses", "jockeys", "trainers", "owners", "race_plans",
    "kra_news", "kra_videos", "weather_observations", "sync_meta",
)



@pytest.fixture(scope="module")
def e2e() -> Any:
    if not E2E_URL:
        pytest.skip("E2E_DATABASE_URL 미설정")
    _assert_safe_target(E2E_URL)

    from zoneinfo import ZoneInfo

    import httpx
    from e2e_world import (
        CHULMA_OP,
        KMA_KEY,
        KRA_KEY_ENCODED,
        NAVER_ID,
        NAVER_SECRET,
        YT_CHANNEL,
        YT_KEY,
        Clock,
        FakeWeb,
        FakeWorld,
    )
    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker

    import src.db as db
    import src.jobs.sync_horses as sync_horses
    import src.monitoring as monitoring
    import src.scheduler_main as scheduler_main
    from src.config import settings

    # E2E_REAL_NOW=YYYY-MM-DD 로 "실제 오늘" 을 고정해 요일별 동작을 재현할 수 있다.
    # DB 쪽 NOW()/CURRENT_DATE 는 못 바꾸므로 실제 날짜 ±2일 안에서만 의미가 있다
    # (그보다 과거로 두면 다음 경주일 U 가 DB 기준 과거가 돼 웹·알림 쿼리가 빈다).
    pinned = os.environ.get("E2E_REAL_NOW")
    real_now = (
        _dt.datetime.combine(_dt.date.fromisoformat(pinned), _dt.time(12),
                             tzinfo=ZoneInfo("Asia/Seoul"))
        if pinned else _dt.datetime.now(ZoneInfo("Asia/Seoul"))
    )
    world = FakeWorld(real_now)
    clock = Clock()
    web = FakeWeb(world, clock)
    dash = DashRecorder()
    mp = pytest.MonkeyPatch()

    # ---- settings (frozen dataclass) — 더미 키 주입, 끝나면 원복
    kra_fields = [f.name for f in dataclasses.fields(settings) if f.name.startswith("kra_key_")]
    overrides: dict[str, str] = dict.fromkeys(kra_fields, KRA_KEY_ENCODED)
    overrides.update(
        kma_service_key=KMA_KEY, youtube_api_key=YT_KEY, youtube_krbc_channel_id=YT_CHANNEL,
        kra_chulma_operation=CHULMA_OP, naver_search_client_id=NAVER_ID,
        naver_search_client_secret=NAVER_SECRET,
    )
    saved = {k: getattr(settings, k) for k in overrides}
    for k, v in overrides.items():
        object.__setattr__(settings, k, v)

    # ---- DB
    url = E2E_URL
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    engine = create_engine(url, future=True, pool_pre_ping=True)
    mp.setattr(db, "engine", engine)
    mp.setattr(db, "SessionLocal", sessionmaker(bind=engine, expire_on_commit=False, future=True))
    with engine.begin() as c:
        sp = c.execute(text("SHOW search_path")).scalar()
        if not c.execute(text("SELECT to_regclass('mal.races') IS NOT NULL")).scalar():
            pytest.exit(
                f"mal.races 없음 (search_path={sp}) — tests/e2e/setup_db.sh 로 prod 레이아웃"
                "(mal 스키마 + search_path=mal,public) DB 를 만들 것",
                returncode=2,
            )
        c.execute(text(f"TRUNCATE {', '.join(_DATA_TABLES)} RESTART IDENTITY CASCADE"))

    # ---- HTTP seam — 모든 httpx.Client 에 MockTransport 주입
    transport = httpx.MockTransport(web.handler)
    real_client = httpx.Client

    class _MockedClient(real_client):  # type: ignore[misc, valid-type]
        def __init__(self, *a: Any, **kw: Any) -> None:
            kw["transport"] = transport
            super().__init__(*a, **kw)

    mp.setattr(httpx, "Client", _MockedClient)

    # ---- 시계 (scheduler_main import 로 src.* 전부 로드된 뒤 교체)
    fake_date, fake_dt = make_fake_time(clock)
    for name, mod in list(sys.modules.items()):
        if mod is None or not (name == "src" or name.startswith("src.")):
            continue
        if getattr(mod, "date", None) is _dt.date:
            mp.setattr(mod, "date", fake_date)
        if getattr(mod, "datetime", None) is _dt.datetime:
            mp.setattr(mod, "datetime", fake_dt)
    mp.setattr(sync_horses, "time", types.SimpleNamespace(sleep=lambda _s: None))

    # ---- 대시보드
    mp.setattr(monitoring, "dash", dash)
    mp.setattr(monitoring, "_registered", set())

    # ---- scheduler_main.main() 을 가짜 스케줄러로 실행 → 등록 job / TRIGGER_JOBS 수집
    started: list[Any] = []

    class _FakeScheduler:
        def __init__(self, timezone: Any = None) -> None:
            self.timezone = timezone
            self.added: list[tuple[str, Any, Any]] = []

        def add_job(self, func: Any, trigger: Any, id: str, **_kw: Any) -> None:  # noqa: A002
            self.added.append((id, func, trigger))

        def get_jobs(self) -> list[Any]:
            return [types.SimpleNamespace(id=i) for i, _, _ in self.added]

        def start(self) -> None:
            started.append(self)

    mp.setattr(scheduler_main, "BlockingScheduler", _FakeScheduler)
    mp.setattr(scheduler_main, "dash", dash)
    scheduler_main.main()
    sched = started[0]
    poll = next(f for i, f, _ in sched.added if i == "mal.trigger_poll")
    poll()
    polls = [c for c in dash.calls if c[0] == "poll"]
    trigger_jobs = polls[-1][1][0]
    jobs = {i: f for i, f, _ in sched.added if i != "mal.trigger_poll"}
    triggers = {i: t for i, _, t in sched.added}
    env = E2EEnv(world, clock, web, dash, engine, jobs, trigger_jobs, triggers)
    env.scheduler_timezone = str(sched.timezone)
    env.registered = [c[2]["job_key"] for c in dash.calls if c[0] == "register"]
    dash.calls.clear()
    try:
        yield env
    finally:
        mp.undo()
        for k, v in saved.items():
            object.__setattr__(settings, k, v)
        engine.dispose()
