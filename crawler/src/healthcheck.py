"""운영자용 읽기 전용 크롤러 헬스체크 — `python -m src.main healthcheck`.

dev 환경에서는 prod 에 닿을 수 없으므로 운영자가 prod 호스트에서 직접 실행한다::

    docker exec mal-crawler python -m src.main healthcheck          # 표
    docker exec mal-crawler python -m src.main healthcheck --json   # 기계 판독용

원칙
- **READ-ONLY** — 외부 API(KRA/KMA/YouTube/Naver) 호출 없음, DB 쓰기 없음. 모든 쿼리는
  `SET TRANSACTION READ ONLY` + statement/lock timeout 트랜잭션 안에서 돌고 rollback 된다
  (prod 락을 잡지 않도록 — CLAUDE.md "운영 DB 직접 query" 주의). 유일한 네트워크 호출은
  선택적인 crawler-dashboard GET (3초 timeout) 하나.
- env 는 **있음/없음만** 출력 — 값은 어디에도 찍지 않는다.
- 종료코드: 0 = 전부 OK, 1 = FAIL 이 하나라도 있음, 2 = WARN 만 있음.
- 경주일은 요일을 하드코딩하지 않고 races ∪ race_entries ∪ race_results 에서 도출한다
  (금/토/일 + 공휴일 개최·휴장 모두 데이터가 말해 줌).

구조: SQL 은 `QUERIES` 에 이름으로 모아 두고, 점검 함수는 `RowProvider.rows(name, **params)`
로만 DB 를 본다 → 테스트는 가짜 provider 로 판정 로직을 그대로 검증한다.
"""
from __future__ import annotations

import json
import os
import re
import time as _time
import unicodedata
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from enum import StrEnum
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from .redact import redact

KST = ZoneInfo("Asia/Seoul")
_WEEKDAY_KO = "월화수목금토일"


class Status(StrEnum):
    OK = "OK"
    WARN = "WARN"
    FAIL = "FAIL"


@dataclass(frozen=True)
class Check:
    area: str
    name: str
    status: Status
    detail: str


# ── 임계값 ─────────────────────────────────────────────────────────────────────
# 스케줄 근거는 src/scheduler_main.py. 숫자를 바꾸면 docs/spec/deployment.md 도 함께.
CALENDAR_LOOKBACK_DAYS = 35  # 주간 패턴·불변식 창 (30일 + 여유)
CALENDAR_LOOKAHEAD_DAYS = 14  # sync_race_entries 는 10일 앞까지 수집
# 예정 경주일이 DB 에 하나도 없을 때, 직전 경주일로부터 며칠 지나면 경고/실패.
# (일→금 공백이 5일. KRA 출전표는 보통 경주 2~3일 전 공개 → 4일째면 들어와 있어야 함.
#  10일 이상은 휴장이 아니면 sync_race_entries 가 죽은 것.)
NEXT_DAY_WARN_GAP_DAYS = 4
NEXT_DAY_FAIL_GAP_DAYS = 10
# 주간 패턴: 지난주 같은 요일에 경주가 있었는데 [오늘-3, 오늘] 에 races/출전표가 없으면 경고.
WEEKLY_PATTERN_BACK_DAYS = 3
# 어제 결과 잔여 catchup(sync_yesterday_residual 09~12시) 이 끝나는 시각.
RESIDUAL_DEADLINE = time(12, 30)
# 당일 결과(live 22:30 + backstop sync_races_today 23:05) 를 점검하기 시작하는 시각.
TODAY_RESULTS_AFTER = time(23, 30)
INVARIANT_LOOKBACK_DAYS = 30
RATINGS_WARN_DAYS = 8  # 토 07:30 주 1회 → 8일 초과면 한 주 누락
RATINGS_FAIL_DAYS = 15  # 두 주 연속 누락
RANK_CHANGES_OK_HOURS = 30  # 매일 06:35 전체 UPSERT (updated_at 갱신)
RANK_CHANGES_FAIL_HOURS = 72
JOCKEY_CHANGES_OK_HOURS = 30  # 매일 06:25, KRA 윈도우가 비면 updated_at 이 안 바뀔 수 있음
JOCKEY_CHANGES_FAIL_DAYS = 14
WEATHER_FETCH_DONE = time(3, 30)  # sync_weather 03:00 (어제까지 수집)
NEWS_OK_DAYS = 1  # sync_news 30분 주기
NEWS_FAIL_DAYS = 3
VIDEOS_FAIL_DAYS = 7  # 직전 경주일 대비 매칭 영상이 이만큼 뒤처지면 실패
HORSES_UNRESOLVED_WARN = 100  # raw NULL 중 not-found 원장에 없는 마필

STATEMENT_TIMEOUT_MS = 15_000
LOCK_TIMEOUT_MS = 2_000


# ── 1. 설정 (env 있음/없음) ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class EnvGroup:
    label: str
    jobs: str
    required: tuple[str, ...]
    severity: Status  # 하나라도 없을 때의 판정
    note: str = ""


ENV_GROUPS: tuple[EnvGroup, ...] = (
    EnvGroup("DB", "전체 잡", ("DATABASE_URL",), Status.FAIL,
             "미설정 시 localhost:5434 기본값으로 붙음"),
    EnvGroup("대시보드 리포트", "@track_job", ("CRAWLER_SECRET",), Status.FAIL,
             "없으면 run 리포트 전멸 (152일 stale 사고)"),
    EnvGroup("대시보드 주소", "@track_job", ("DASHBOARD_URL",), Status.WARN,
             "compose 기본값 http://crawler-dashboard:3100"),
    # races·dividends·sales·corners·horses·jockeys·trainers·owners·ratings·plan …
    EnvGroup("KRA OpenAPI", "KRA 잡 전체", ("KRA_SERVICE_KEY",), Status.FAIL),
    EnvGroup("출전표", "sync_race_entries", ("KRA_CHULMA_OPERATION",), Status.FAIL,
             "없으면 race_entries 0건 (4/25 사고)"),
    EnvGroup("날씨", "sync_weather", ("KMA_SERVICE_KEY",), Status.FAIL),
    # sync_videos · sync_videos_backfill · sync_videos_bulk
    EnvGroup("영상", "sync_videos*", ("YOUTUBE_API_KEY", "YOUTUBE_KRBC_CHANNEL_ID"), Status.FAIL),
    EnvGroup("뉴스", "sync_news", ("NAVER_SEARCH_CLIENT_ID", "NAVER_SEARCH_CLIENT_SECRET"),
             Status.FAIL),
    EnvGroup("실패 알림", "Telegram", ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"), Status.WARN,
             "없으면 실패 알림만 조용히 skip"),
)

KST_OFFSET_SEC = 9 * 3600


def _present(env: Mapping[str, str], name: str) -> bool:
    return bool((env.get(name) or "").strip())


def check_config(env: Mapping[str, str], *, gmtoff_sec: int) -> list[Check]:
    """env 존재 여부만 본다 — 값은 읽어서 비교하지도 출력하지도 않는다."""
    out: list[Check] = []
    for g in ENV_GROUPS:
        missing = [n for n in g.required if not _present(env, n)]
        detail = " · ".join(f"{n} {'없음' if n in missing else '있음'}" for n in g.required)
        status = g.severity if missing else Status.OK
        if missing and g.label == "KRA OpenAPI":
            # config.py: 공통 키 대신 API 별 KRA_SERVICE_KEY_* 만 둘 수도 있다.
            overrides = sorted(
                k for k in env if k.startswith("KRA_SERVICE_KEY_") and _present(env, k)
            )
            if overrides:
                status = Status.WARN
                detail += (
                    f" (개별 KRA_SERVICE_KEY_* {len(overrides)}개만 있음 — 나머지 API 는 빈 키)"
                )
        if missing and g.note:
            detail += f" — {g.note}"
        out.append(Check("설정", f"{g.label} ({g.jobs})", status, detail))

    # 잡 본체 일부가 date.today() 를 쓴다 — 프로세스 TZ 가 KST 가 아니면 catchup 이 D-2 보정.
    tz_name = env.get("TZ") or "(미설정)"
    hours = gmtoff_sec / 3600
    tz_detail = f"TZ={tz_name} · UTC{hours:+g}"
    if gmtoff_sec == KST_OFFSET_SEC:
        out.append(Check("설정", "프로세스 시간대", Status.OK, tz_detail))
    else:
        out.append(Check(
            "설정", "프로세스 시간대", Status.FAIL,
            f"{tz_detail} — KST 아님: date.today() 잡이 하루 밀림 (compose TZ=Asia/Seoul)",
        ))
    return out


# ── DB 접근 ─────────────────────────────────────────────────────────────────────

# 경주 키 (race_date, meet, race_no) 를 뽑는 테이블. race_results 는 확정(rank) 행만.
RACE_KEY_TABLES: dict[str, str] = {
    "races": "",
    "race_entries": "",
    "race_results": " AND rank IS NOT NULL",
    "race_dividends": "",
    "race_combo_dividends": "",
    "race_pool_sales": "",
    "race_corners": "",
}

_LEDGER_SQL = """
SELECT source,
       last_run_at,
       last_success_at,
       last_error IS NOT NULL AS has_error,
       (SELECT COUNT(*) FROM jsonb_each(
            CASE WHEN jsonb_typeof(raw -> 'attempts') = 'object'
                 THEN raw -> 'attempts' ELSE '{}'::jsonb END)) AS attempts,
       (SELECT COUNT(*) FROM jsonb_each(
            CASE WHEN jsonb_typeof(raw -> 'attempts') = 'object'
                 THEN raw -> 'attempts' ELSE '{}'::jsonb END) a
         WHERE (a.value ->> 'n') ~ '^[0-9]+$'
           AND (a.value ->> 'n')::int >= :max_attempts) AS exhausted
  FROM sync_meta
 ORDER BY source
"""

QUERIES: dict[str, str] = {
    "db_info": """
        SELECT current_database()                        AS db,
               current_user                              AS db_user,
               current_setting('TimeZone')               AS tz,
               current_setting('search_path')            AS search_path,
               CURRENT_DATE                              AS db_date,
               (now() AT TIME ZONE 'Asia/Seoul')::date   AS db_kst_date
    """,
    "migrations_table": "SELECT to_regclass('_migrations_applied') IS NOT NULL AS present",
    "migrations_latest": """
        SELECT filename, applied_at, (SELECT COUNT(*) FROM _migrations_applied) AS total
          FROM _migrations_applied
         ORDER BY filename DESC
         LIMIT 1
    """,
    "race_bounds": """
        SELECT GREATEST(
                 (SELECT MAX(race_date) FROM races        WHERE race_date < :today),
                 (SELECT MAX(race_date) FROM race_entries WHERE race_date < :today),
                 (SELECT MAX(race_date) FROM race_results WHERE race_date < :today)
               ) AS last_before,
               GREATEST(
                 (SELECT MAX(race_date) FROM races),
                 (SELECT MAX(race_date) FROM race_entries)
               ) AS latest
    """,
    **{
        f"race_keys:{table}": (
            f"SELECT DISTINCT race_date, meet, race_no FROM {table}"
            f" WHERE race_date BETWEEN :lo AND :hi{extra}"
        )
        for table, extra in RACE_KEY_TABLES.items()
    },
    "race_corners_total": "SELECT COUNT(*) AS n FROM race_corners",
    "horse_ratings": """
        SELECT MAX(snapshot_date) AS latest,
               COUNT(*) FILTER (
                 WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM horse_ratings)
               ) AS latest_rows
          FROM horse_ratings
    """,
    "horse_rank_changes": """
        SELECT MAX(updated_at) AS updated, MAX(st_date) AS latest_event
          FROM horse_rank_changes
    """,
    "jockey_changes": """
        SELECT MAX(updated_at) AS updated, MAX(race_date) AS latest_event
          FROM jockey_changes
    """,
    "horses_raw_null": """
        SELECT COUNT(*) AS n FROM horses
         WHERE raw IS NULL OR jsonb_typeof(raw) <> 'object'
    """,
    "weather_latest": """
        SELECT station_id, MAX(obs_time) AS latest
          FROM weather_observations
         GROUP BY station_id
    """,
    "news_latest": """
        SELECT MAX(published_at) AS latest,
               COUNT(*) FILTER (WHERE published_at >= now() - interval '1 day') AS last_24h
          FROM kra_news
    """,
    "videos_latest": """
        SELECT MAX(race_date)                                        AS latest_race_date,
               MAX(published_at) FILTER (WHERE race_date IS NOT NULL) AS latest_matched_pub,
               MAX(published_at)                                     AS latest_pub
          FROM kra_videos
    """,
    "race_plans_years": """
        SELECT year, COUNT(*) AS n FROM race_plans
         WHERE year IN (:year, :next_year)
         GROUP BY year
    """,
    "sync_meta": _LEDGER_SQL,
}


class RowProvider(Protocol):
    def rows(self, name: str, **params: Any) -> list[dict[str, Any]]: ...


class SqlRowProvider:
    """`QUERIES[name]` 을 읽기 전용 트랜잭션 하나로 실행하고 rollback.

    쿼리마다 트랜잭션을 따로 쓴다 — 한 점검의 실패(테이블 없음 등)가 다음 점검의
    트랜잭션을 abort 상태로 오염시키지 않도록.
    """

    def __init__(self, engine: Any) -> None:
        self._engine = engine

    def rows(self, name: str, **params: Any) -> list[dict[str, Any]]:
        from sqlalchemy import text

        sql = QUERIES[name]
        with self._engine.connect() as conn:
            trans = conn.begin()
            try:
                # 반드시 트랜잭션의 첫 문장 — 이후 쓰기 시도는 DB 가 거부한다.
                conn.execute(text("SET TRANSACTION READ ONLY"))
                conn.execute(text(f"SET LOCAL statement_timeout = {int(STATEMENT_TIMEOUT_MS)}"))
                conn.execute(text(f"SET LOCAL lock_timeout = {int(LOCK_TIMEOUT_MS)}"))
                result = conn.execute(text(sql), params)
                return [dict(r._mapping) for r in result]
            finally:
                trans.rollback()


def _one(db: RowProvider, name: str, **params: Any) -> dict[str, Any]:
    rows = db.rows(name, **params)
    return rows[0] if rows else {}


_URL_PASSWORD_RE = re.compile(r"(://[^:/@\s]+):[^@\s]+@")


def _err(exc: BaseException) -> str:
    """예외 요약 — 공백 정리 + API 키·DSN 비밀번호 마스킹 + 길이 제한."""
    msg = " ".join(str(exc).split())
    msg = _URL_PASSWORD_RE.sub(r"\1:***@", msg)
    return redact(f"{type(exc).__name__}: {msg}")[:200]


# ── 표시 헬퍼 ───────────────────────────────────────────────────────────────────


def _d(d: date | None) -> str:
    if d is None:
        return "없음"
    return f"{d.isoformat()}({_WEEKDAY_KO[d.weekday()]})"


def _kst(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:  # timestamptz 는 항상 aware — 방어용 (UTC 로 간주)
        dt = dt.replace(tzinfo=ZoneInfo("UTC"))
    return dt.astimezone(KST)


def _dt(dt: datetime | None) -> str:
    k = _kst(dt)
    return k.strftime("%Y-%m-%d %H:%M KST") if k else "없음"


def _ago(delta: timedelta) -> str:
    secs = int(delta.total_seconds())
    if secs < 0:
        return "미래"
    if secs < 3600:
        return f"{secs // 60}분 전"
    if secs < 2 * 86400:
        return f"{secs // 3600}시간 전"
    return f"{secs // 86400}일 전"


def _norm_meet(meet: Any) -> str:
    m = str(meet or "").strip()
    return "부경" if m == "부산경남" else m


RaceKey = tuple[date, str, int]


def _race_keys(db: RowProvider, table: str, lo: date, hi: date) -> set[RaceKey]:
    return {
        (r["race_date"], _norm_meet(r["meet"]), int(r["race_no"]))
        for r in db.rows(f"race_keys:{table}", lo=lo, hi=hi)
        if r.get("race_date") is not None and r.get("race_no") is not None
    }


def _on(keys: Iterable[RaceKey], d: date) -> set[RaceKey]:
    return {k for k in keys if k[0] == d}


# ── 경주 캘린더 ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RaceCalendar:
    """[오늘-35, 오늘+14] 창의 경주 키 + 창 밖까지 보는 경계값."""

    today: date
    races: frozenset[RaceKey]  # races ∪ race_entries ∪ race_results(확정)
    entries: frozenset[RaceKey]
    results: frozenset[RaceKey]
    last_before: date | None  # 오늘 이전 마지막 경주일
    latest: date | None  # races/race_entries 의 최신 경주일

    @property
    def race_days(self) -> list[date]:
        return sorted({k[0] for k in self.races})

    @property
    def upcoming(self) -> list[date]:
        return [d for d in self.race_days if d >= self.today]


def load_calendar(db: RowProvider, today: date) -> RaceCalendar:
    lo = today - timedelta(days=CALENDAR_LOOKBACK_DAYS)
    hi = today + timedelta(days=CALENDAR_LOOKAHEAD_DAYS)
    races = _race_keys(db, "races", lo, hi)
    entries = _race_keys(db, "race_entries", lo, hi)
    results = _race_keys(db, "race_results", lo, hi)
    bounds = _one(db, "race_bounds", today=today)
    all_keys = races | entries | results
    in_window = [k[0] for k in all_keys if k[0] < today]
    candidates = [d for d in (bounds.get("last_before"), max(in_window, default=None)) if d]
    latest_candidates = [
        d for d in (bounds.get("latest"), max((k[0] for k in all_keys), default=None)) if d
    ]
    return RaceCalendar(
        today=today,
        races=frozenset(all_keys),
        entries=frozenset(entries),
        results=frozenset(results),
        last_before=max(candidates, default=None),
        latest=max(latest_candidates, default=None),
    )


def check_next_race_day(cal: RaceCalendar) -> Check:
    name = "다음 경주일 출전표"
    latest = f"최신 경주일 {_d(cal.latest)}"
    if cal.upcoming:
        nxt = cal.upcoming[0]
        day = _on(cal.races, nxt)
        with_entries = _on(cal.entries, nxt)
        missing = len(day) - len(day & with_entries)
        head = f"{_d(nxt)} {len(day)}경주 · 출전표 {len(day) - missing}/{len(day)}"
        if missing == 0:
            return Check("경주", name, Status.OK, f"{head} · {latest}")
        status = Status.FAIL if nxt == cal.today else Status.WARN
        return Check(
            "경주", name, status,
            f"{head} — 출전표 없는 경주 {missing}건 (sync_race_entries 3h 주기 확인)",
        )
    if cal.last_before is None:
        return Check("경주", name, Status.FAIL, "races·race_entries 에 경주일이 하나도 없음")
    gap = (cal.today - cal.last_before).days
    head = f"예정 경주일 없음 · 직전 경주일 {_d(cal.last_before)} ({gap}일 전)"
    if gap >= NEXT_DAY_FAIL_GAP_DAYS:
        return Check(
            "경주", name, Status.FAIL,
            f"{head} — 휴장이 아니면 sync_race_entries 정지 (KRA_CHULMA_OPERATION·쿼터 확인)",
        )
    if gap >= NEXT_DAY_WARN_GAP_DAYS:
        return Check(
            "경주", name, Status.WARN,
            f"{head} — 다음 경주일 출전표가 아직 없음 (휴장 주간이면 무시)",
        )
    return Check("경주", name, Status.OK, f"{head} — 출전표 공개 대기")


def check_weekly_pattern(cal: RaceCalendar) -> Check:
    """지난주 같은 요일엔 경주가 있었는데 최근 며칠 races/출전표가 통째로 빈 날."""
    name = "경주일 누락 (주간 패턴)"
    days = set(cal.race_days)
    expected = [
        cal.today - timedelta(days=i)
        for i in range(WEEKLY_PATTERN_BACK_DAYS, -1, -1)
    ]
    absent = [d for d in expected if (d - timedelta(days=7)) in days and d not in days]
    if not absent:
        return Check("경주", name, Status.OK, "지난주 같은 요일 대비 빈 경주일 없음")
    return Check(
        "경주", name, Status.WARN,
        f"{', '.join(_d(d) for d in absent)} — 지난주 같은 요일엔 경주 있었으나 races·출전표·결과 "
        "모두 없음 (휴장/공휴일 조정이 아니면 수집 누락)",
    )


def check_last_day_results(cal: RaceCalendar, now: datetime) -> Check:
    name = "직전 경주일 결과"
    last = cal.last_before
    if last is None:
        return Check("결과", name, Status.WARN, "오늘 이전 경주일 없음 — 점검 생략")
    day = _on(cal.races, last)
    done = _on(cal.results, last)
    total = len(day)
    missing = total - len(day & done)
    head = f"{_d(last)} 결과 {total - missing}/{total}"
    if total == 0:  # 창 밖 (35일 이상 전) — 경계값만 안다
        return Check("결과", name, Status.WARN, f"{_d(last)} — 점검 창 밖, 경주 수 미확인")
    if missing == 0:
        return Check("결과", name, Status.OK, head)
    hint = f"`python -m src.main sync-race-date {last.isoformat()}`"
    if missing == total:
        return Check(
            "결과", name, Status.FAIL,
            f"{head} — 결과 전무 (live·23:05 sync_races_today·07:30 catchup 모두 미수집) → {hint}",
        )
    yesterday = now.date() - timedelta(days=1)
    if last == yesterday and now.time() < RESIDUAL_DEADLINE:
        return Check(
            "결과", name, Status.WARN,
            f"{head} — 일부 미수집, sync_yesterday_residual(09~12시) 진행 중",
        )
    return Check(
        "결과", name, Status.WARN,
        f"{head} — {missing}경주 결과 없음 (취소 경주가 아니면 {hint})",
    )


def check_today_results(cal: RaceCalendar, now: datetime) -> list[Check]:
    """오늘이 경주일이고 23시 이후면 당일 결과도 본다 (22:00 sync + live 22:30 이후)."""
    today = cal.today
    day = _on(cal.races, today)
    if not day or now.time() < TODAY_RESULTS_AFTER:
        return []
    done = _on(cal.results, today)
    missing = len(day) - len(day & done)
    head = f"{_d(today)} 결과 {len(day) - missing}/{len(day)}"
    if missing == 0:
        return [Check("결과", "오늘 결과", Status.OK, head)]
    return [Check(
        "결과", "오늘 결과", Status.WARN,
        f"{head} — 22:00 sync 이후에도 미수집, 07:30 catchup 대기",
    )]


def check_results_invariant(cal: RaceCalendar) -> Check:
    """catchup 불변식: 출전표가 있는 지난 경주는 결과가 있어야 한다 (직전 경주일 제외)."""
    name = f"출전표 있고 결과 없음 ({INVARIANT_LOOKBACK_DAYS}일)"
    lo = cal.today - timedelta(days=INVARIANT_LOOKBACK_DAYS)
    hi = cal.last_before  # 직전 경주일은 위 행에서 판정
    if hi is None:
        return Check("결과", name, Status.OK, "대상 경주일 없음")
    orphan = sorted(k for k in cal.entries - cal.results if lo <= k[0] < hi)
    if not orphan:
        return Check("결과", name, Status.OK, f"0건 ({lo.isoformat()} ~ 직전 경주일 이전)")
    per_day: dict[date, int] = {}
    for k in orphan:
        per_day[k[0]] = per_day.get(k[0], 0) + 1
    days = ", ".join(f"{_d(d)} {n}" for d, n in sorted(per_day.items(), reverse=True)[:5])
    return Check(
        "결과", name, Status.WARN,
        f"{len(orphan)}경주 — {days} (취소 경주가 아니면 sync-race-date 로 보정)",
    )


# 직전 경주일 파생 테이블 — (테이블, 표시명, 0건일 때 판정)
COVERAGE_TABLES: tuple[tuple[str, str, Status], ...] = (
    ("race_dividends", "단승/연승 배당", Status.FAIL),
    ("race_combo_dividends", "복식 배당", Status.FAIL),
    ("race_pool_sales", "풀별 매출", Status.FAIL),
    # 별도 활용신청 API — 승인 전/공개 지연이면 빈 응답이 정상이라 경고까지만.
    ("race_corners", "구간기록", Status.WARN),
)


def check_last_day_coverage(db: RowProvider, cal: RaceCalendar) -> list[Check]:
    last = cal.last_before
    if last is None:
        return []
    base = _on(cal.results, last)  # 결과 확정 경주가 분모
    out: list[Check] = []
    for table, label, zero_status in COVERAGE_TABLES:
        name = f"{label} ({table})"
        if not base:
            out.append(Check("결과", name, Status.WARN, f"{_d(last)} 결과 없음 — 판정 보류"))
            continue
        have = _race_keys(db, table, last, last) & base
        head = f"{_d(last)} {len(have)}/{len(base)}경주"
        if len(have) == len(base):
            out.append(Check("결과", name, Status.OK, head))
        elif not have:
            hint = ""
            if table == "race_corners":
                total = int(_one(db, "race_corners_total").get("n") or 0)
                hint = " · 테이블 전체 0건 (활용신청 전?)" if total == 0 else ""
            out.append(Check("결과", name, zero_status, f"{head} — 0건{hint}"))
        else:
            out.append(Check(
                "결과", name, Status.WARN, f"{head} — {len(base) - len(have)}경주 누락",
            ))
    return out


# ── 그 외 신선도 ────────────────────────────────────────────────────────────────


def check_horse_ratings(db: RowProvider, now: datetime) -> Check:
    name = "레이팅 (horse_ratings)"
    row = _one(db, "horse_ratings")
    latest: date | None = row.get("latest")
    if latest is None:
        return Check("마필", name, Status.FAIL, "스냅샷 없음")
    age = (now.date() - latest).days
    detail = f"최신 snapshot {_d(latest)} ({age}일 전, {int(row.get('latest_rows') or 0)}두)"
    if age > RATINGS_FAIL_DAYS:
        return Check("마필", name, Status.FAIL, f"{detail} — 2주 이상 누락 (토 07:30 잡)")
    if age > RATINGS_WARN_DAYS:
        return Check("마필", name, Status.WARN, f"{detail} — 이번 주 스냅샷 누락")
    return Check("마필", name, Status.OK, detail)


def _recency_check(
    area: str, name: str, row: dict[str, Any], now: datetime,
    *, ok_hours: float, fail_hours: float, schedule: str,
) -> Check:
    updated = _kst(row.get("updated"))
    event = row.get("latest_event")
    if updated is None:
        return Check(area, name, Status.FAIL, "행 없음")
    age = now - updated
    detail = f"갱신 {_dt(updated)} ({_ago(age)}) · 최신 이벤트 {_d(event)}"
    hours = age.total_seconds() / 3600
    if hours > fail_hours:
        return Check(area, name, Status.FAIL, f"{detail} — {schedule} 잡 정지 의심")
    if hours > ok_hours:
        return Check(area, name, Status.WARN, f"{detail} — 최근 {schedule} 실행분 미반영")
    return Check(area, name, Status.OK, detail)


def check_rank_changes(db: RowProvider, now: datetime) -> Check:
    return _recency_check(
        "마필", "등급변동 (horse_rank_changes)", _one(db, "horse_rank_changes"), now,
        ok_hours=RANK_CHANGES_OK_HOURS, fail_hours=RANK_CHANGES_FAIL_HOURS,
        schedule="매일 06:35",
    )


def check_jockey_changes(db: RowProvider, now: datetime) -> Check:
    return _recency_check(
        "마필", "기수변경 (jockey_changes)", _one(db, "jockey_changes"), now,
        ok_hours=JOCKEY_CHANGES_OK_HOURS, fail_hours=JOCKEY_CHANGES_FAIL_DAYS * 24,
        schedule="매일 06:25",
    )


def _ledgers(db: RowProvider) -> dict[str, dict[str, Any]]:
    from .jobs.sync_horses import NOT_FOUND_MAX_ATTEMPTS

    # 두 원장 모두 3회가 한도 — chunked_backfill_dividends.MAX_ATTEMPTS_DEFAULT 와 동일.
    return {
        str(r["source"]): r
        for r in db.rows("sync_meta", max_attempts=NOT_FOUND_MAX_ATTEMPTS)
    }


def check_horses_raw(db: RowProvider, ledgers: dict[str, dict[str, Any]]) -> Check:
    from .jobs.sync_horses import NOT_FOUND_LEDGER_SOURCE

    name = "마필 raw NULL (horses)"
    n = int(_one(db, "horses_raw_null").get("n") or 0)
    led = ledgers.get(NOT_FOUND_LEDGER_SOURCE) or {}
    known = int(led.get("attempts") or 0)
    exhausted = int(led.get("exhausted") or 0)
    unresolved = max(n - known, 0)
    detail = f"{n}두 · not-found 원장 {known} (exhausted {exhausted}) · 미분류 {unresolved}"
    if unresolved > HORSES_UNRESOLVED_WARN:
        return Check(
            "마필", name, Status.WARN,
            f"{detail} — sync_horses_backfill(06:30) 가 따라잡지 못함",
        )
    return Check("마필", name, Status.OK, detail)


def check_weather(db: RowProvider, now: datetime) -> Check:
    from .clients.kma_asos import ALL_STATIONS

    name = "날씨 (weather_observations)"
    today = now.date()
    # KMA 시간자료는 전날까지만 제공하고, 전날 관측은 다음 날 정오 무렵에야 확정된다
    # (sync_weather docstring). 03:00 잡 직후엔 그저께까지만 있는 게 정상 → 기대치는
    # 03:00 이후 D-2, 이전 D-3. 그보다 하루 더 밀리면 WARN, 이틀이면 FAIL.
    expected = today - timedelta(days=2 if now.time() >= WEATHER_FETCH_DONE else 3)
    latest = {
        int(r["station_id"]): _kst(r["latest"]).date()
        for r in db.rows("weather_latest") if r.get("latest") is not None
    }
    per = [(s, latest.get(s)) for s in ALL_STATIONS]
    oldest = min((d for _, d in per if d is not None), default=None)
    missing = [s for s, d in per if d is None]
    detail = "최신 " + " · ".join(f"{s}:{d.isoformat() if d else '없음'}" for s, d in per)
    if missing or oldest is None or oldest < expected - timedelta(days=1):
        return Check(
            "외부", name, Status.FAIL,
            f"{detail} — 기대 {expected.isoformat()} 이상"
            " (sync_weather 03:00·KMA_SERVICE_KEY 확인)",
        )
    if oldest < expected:
        return Check("외부", name, Status.WARN, f"{detail} — 하루 지연 (KMA 확정 지연 가능)")
    return Check("외부", name, Status.OK, detail)


def check_news(db: RowProvider, now: datetime) -> Check:
    name = "뉴스 (kra_news)"
    row = _one(db, "news_latest")
    latest = _kst(row.get("latest"))
    if latest is None:
        return Check("외부", name, Status.FAIL, "기사 없음")
    age = now - latest
    detail = f"최신 기사 {_dt(latest)} ({_ago(age)}) · 24h {int(row.get('last_24h') or 0)}건"
    if age > timedelta(days=NEWS_FAIL_DAYS):
        return Check("외부", name, Status.FAIL, f"{detail} — sync_news(30분) 정지 의심")
    if age > timedelta(days=NEWS_OK_DAYS):
        return Check("외부", name, Status.WARN, f"{detail} — 하루 넘게 새 기사 없음")
    return Check("외부", name, Status.OK, detail)


def check_videos(db: RowProvider, now: datetime, last_race_day: date | None) -> Check:
    name = "경주 영상 (kra_videos)"
    row = _one(db, "videos_latest")
    matched: date | None = row.get("latest_race_date")
    detail = (
        f"매칭 최신 경주일 {_d(matched)} · 최신 업로드 {_dt(row.get('latest_pub'))}"
    )
    if matched is None:
        return Check("외부", name, Status.FAIL, f"{detail} — 경주 매칭 영상 없음")
    ref = last_race_day or now.date()
    if matched >= ref:
        return Check("외부", name, Status.OK, detail)
    lag = (ref - matched).days
    if lag > VIDEOS_FAIL_DAYS:
        return Check(
            "외부", name, Status.FAIL,
            f"{detail} — 직전 경주일보다 {lag}일 뒤처짐 (sync_videos·YOUTUBE_* 확인)",
        )
    return Check(
        "외부", name, Status.WARN,
        f"{detail} — 직전 경주일 {_d(ref)} 영상 미매칭 (23:00 videos_backfill 대기)",
    )


def check_race_plans(db: RowProvider, now: datetime) -> Check:
    from .jobs.sync_race_plan import NEXT_YEAR_MONTHS, SOFT_CURRENT_YEAR_MONTHS

    name = "대상경주 계획 (race_plans)"
    year = now.year
    counts = {
        int(r["year"]): int(r["n"] or 0)
        for r in db.rows("race_plans_years", year=year, next_year=year + 1)
    }
    cur, nxt = counts.get(year, 0), counts.get(year + 1, 0)
    detail = f"{year}년 {cur}건"
    if now.month in NEXT_YEAR_MONTHS:
        detail += f" · {year + 1}년 {nxt}건"
    if cur == 0:
        status = Status.WARN if now.month in SOFT_CURRENT_YEAR_MONTHS else Status.FAIL
        return Check("기타", name, status, f"{detail} — 올해 계획 없음 (05:00 sync_race_plan)")
    if now.month in NEXT_YEAR_MONTHS and nxt == 0:
        return Check(
            "기타", name, Status.WARN,
            f"{detail} — 내년 계획 미수집 (KRA 공개 전일 수 있음)",
        )
    return Check("기타", name, Status.OK, detail)


def check_ledgers(ledgers: dict[str, dict[str, Any]]) -> Check:
    from .jobs.chunked_backfill_dividends import SOURCE_KEY as DIVIDENDS_LEDGER

    name = "sync_meta 원장"
    div = ledgers.get(DIVIDENDS_LEDGER) or {}
    pending = int(div.get("attempts") or 0)
    exhausted = int(div.get("exhausted") or 0)
    errored = sorted(s for s, r in ledgers.items() if r.get("has_error"))
    parts = [
        f"rows {len(ledgers)}",
        f"배당 백필 gap {pending} (exhausted {exhausted}, 마지막 {_dt(div.get('last_run_at'))})",
    ]
    if errored:
        parts.append(f"last_error: {', '.join(errored)}")
    detail = " · ".join(parts)
    # exhausted gap 은 설계상 365일 창 안에 계속 남는다 (KRA 가 combo 를 안 주는 조합) —
    # 매번 WARN 이면 exit 2 가 상시가 돼 의미가 없으니 정보로만 표시.
    if errored:
        return Check(
            "기타", name, Status.WARN, f"{detail} — last_error 소스의 최근 실행 확인",
        )
    if exhausted:
        detail += " — exhausted 는 정보 (원장 row 삭제 시 재시도)"
    return Check("기타", name, Status.OK, detail)


# ── 2. DB ───────────────────────────────────────────────────────────────────────


def check_db(db: RowProvider, now: datetime) -> tuple[list[Check], bool]:
    """연결·시간대·마이그레이션. 두 번째 값 = 연결 성공 여부 (실패 시 데이터 점검 생략)."""
    try:
        info = _one(db, "db_info")
    except Exception as exc:  # noqa: BLE001 — 연결 실패 자체가 점검 결과
        return [Check("DB", "연결", Status.FAIL, f"연결 실패 — {_err(exc)}")], False

    out = [Check(
        "DB", "연결", Status.OK,
        f"db={info.get('db')} · user={info.get('db_user')} · search_path={info.get('search_path')}",
    )]
    today = now.date()
    db_kst: date | None = info.get("db_kst_date")
    db_date: date | None = info.get("db_date")
    tz_detail = (
        f"KST 오늘 {_d(today)} · DB TZ={info.get('tz')} · DB CURRENT_DATE={_d(db_date)}"
    )
    if db_kst is not None and db_kst != today:
        out.append(Check(
            "DB", "시간대", Status.WARN,
            f"{tz_detail} — DB 시계의 KST 날짜 {_d(db_kst)} 가 크롤러와 다름 (시계 차이)",
        ))
    else:
        if db_date is not None and db_date != today:
            tz_detail += " (≠ KST — SQL 은 CURRENT_DATE 대신 KST 명시 필요)"
        out.append(Check("DB", "시간대", Status.OK, tz_detail))

    try:
        present = bool(_one(db, "migrations_table").get("present"))
        if not present:
            out.append(Check(
                "DB", "마이그레이션", Status.WARN,
                "_migrations_applied 테이블 없음 (로컬 initdb DB? prod 는 Jenkins Migrate DB)",
            ))
        else:
            m = _one(db, "migrations_latest")
            out.append(Check(
                "DB", "마이그레이션", Status.OK if m else Status.WARN,
                f"최신 {m.get('filename')} (적용 {_dt(m.get('applied_at'))}, 총 {m.get('total')}건)"
                if m else "_migrations_applied 비어 있음",
            ))
    except Exception as exc:  # noqa: BLE001
        out.append(Check("DB", "마이그레이션", Status.FAIL, f"점검 실패 — {_err(exc)}"))
    return out, True


# ── 4. 대시보드 ─────────────────────────────────────────────────────────────────


def check_dashboard(url: str | None, *, timeout: float = 3.0, transport: Any = None) -> Check:
    """crawler-dashboard GET — 닿기만 하면 OK (5xx·접속 실패는 WARN). URL 은 출력 안 함."""
    import httpx

    name = "crawler-dashboard"
    if not (url or "").strip():
        return Check("대시보드", name, Status.WARN, "DASHBOARD_URL 미설정 — 점검 생략")
    try:
        with httpx.Client(timeout=timeout, transport=transport) as client:
            resp = client.get(url.strip())
    except httpx.HTTPError as exc:
        return Check(
            "대시보드", name, Status.WARN,
            f"접속 실패 ({type(exc).__name__}) — 잡은 계속 돌지만 run 리포트 유실",
        )
    if resp.status_code >= 500:
        return Check("대시보드", name, Status.WARN, f"HTTP {resp.status_code}")
    return Check("대시보드", name, Status.OK, f"HTTP {resp.status_code}")


# ── 실행 ────────────────────────────────────────────────────────────────────────


def _guard(area: str, name: str, fn: Callable[[], Check | list[Check]]) -> list[Check]:
    try:
        out = fn()
    except Exception as exc:  # noqa: BLE001 — 한 점검 실패가 나머지를 막지 않도록
        return [Check(area, name, Status.FAIL, f"점검 실패 — {_err(exc)}")]
    return [out] if isinstance(out, Check) else list(out)


def check_data(db: RowProvider, now: datetime) -> list[Check]:
    out: list[Check] = []
    cal: RaceCalendar | None = None
    try:
        cal = load_calendar(db, now.date())
    except Exception as exc:  # noqa: BLE001
        out.append(Check("경주", "경주 캘린더", Status.FAIL, f"점검 실패 — {_err(exc)}"))

    if cal is not None:
        c = cal
        out += _guard("경주", "다음 경주일 출전표", lambda: check_next_race_day(c))
        out += _guard("경주", "경주일 누락 (주간 패턴)", lambda: check_weekly_pattern(c))
        out += _guard("결과", "직전 경주일 결과", lambda: check_last_day_results(c, now))
        out += _guard("결과", "오늘 결과", lambda: check_today_results(c, now))
        out += _guard("결과", "출전표 있고 결과 없음", lambda: check_results_invariant(c))
        out += _guard("결과", "직전 경주일 파생 테이블", lambda: check_last_day_coverage(db, c))

    ledgers: dict[str, dict[str, Any]] = {}
    ledger_error: Exception | None = None
    try:
        ledgers = _ledgers(db)
    except Exception as exc:  # noqa: BLE001
        ledger_error = exc

    out += _guard("마필", "레이팅", lambda: check_horse_ratings(db, now))
    out += _guard("마필", "등급변동", lambda: check_rank_changes(db, now))
    out += _guard("마필", "기수변경", lambda: check_jockey_changes(db, now))
    out += _guard("마필", "마필 raw NULL", lambda: check_horses_raw(db, ledgers))
    out += _guard("외부", "날씨", lambda: check_weather(db, now))
    out += _guard("외부", "뉴스", lambda: check_news(db, now))
    last = cal.last_before if cal else None
    out += _guard("외부", "경주 영상", lambda: check_videos(db, now, last))
    out += _guard("기타", "대상경주 계획", lambda: check_race_plans(db, now))
    if ledger_error is not None:
        out.append(
            Check("기타", "sync_meta 원장", Status.FAIL, f"점검 실패 — {_err(ledger_error)}")
        )
    else:
        out += _guard("기타", "sync_meta 원장", lambda: check_ledgers(ledgers))
    return out


def collect(
    *,
    env: Mapping[str, str],
    db: RowProvider | None,
    now: datetime,
    gmtoff_sec: int,
    dashboard: Callable[[], Check] | None = None,
) -> list[Check]:
    """전체 점검. `db=None` 이면 DB 단계 FAIL 로 기록하고 데이터 점검은 생략."""
    checks = check_config(env, gmtoff_sec=gmtoff_sec)
    if db is None:
        checks.append(Check("DB", "연결", Status.FAIL, "DB 엔진 생성 실패 — 데이터 점검 생략"))
    else:
        db_checks, connected = check_db(db, now)
        checks += db_checks
        if connected:
            checks += check_data(db, now)
        else:
            checks.append(Check("데이터", "신선도", Status.FAIL, "DB 연결 실패 — 데이터 점검 생략"))
    if dashboard is not None:
        checks += _guard("대시보드", "crawler-dashboard", dashboard)
    return checks


def exit_code(checks: Iterable[Check]) -> int:
    statuses = {c.status for c in checks}
    if Status.FAIL in statuses:
        return 1
    if Status.WARN in statuses:
        return 2
    return 0


def _width(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in s)


def _pad(s: str, width: int) -> str:
    return s + " " * max(width - _width(s), 0)


def render_table(checks: list[Check], now: datetime) -> str:
    header = ("상태", "영역", "항목", "내용")
    rows = [(c.status.value, c.area, c.name, c.detail) for c in checks]
    widths = [max(_width(r[i]) for r in [header, *rows]) for i in range(3)]

    def line(cols: tuple[str, str, str, str]) -> str:
        return "  ".join(_pad(cols[i], widths[i]) for i in range(3)) + "  " + cols[3]

    counts = {s: sum(1 for c in checks if c.status == s) for s in Status}
    code = exit_code(checks)
    lines = [
        f"mal-crawler healthcheck · {now.strftime('%Y-%m-%d')}"
        f"({_WEEKDAY_KO[now.weekday()]}) {now.strftime('%H:%M')} KST · 읽기 전용",
        line(header),
        "  ".join("-" * w for w in widths) + "  " + "-" * 4,
        *(line(r) for r in rows),
        f"요약: OK {counts[Status.OK]} · WARN {counts[Status.WARN]} · "
        f"FAIL {counts[Status.FAIL]} → exit {code}",
    ]
    return "\n".join(lines)


def render_json(checks: list[Check], now: datetime) -> str:
    return json.dumps(
        {
            "generated_at": now.isoformat(),
            "exit_code": exit_code(checks),
            "checks": [
                {"area": c.area, "name": c.name, "status": c.status.value, "detail": c.detail}
                for c in checks
            ],
        },
        ensure_ascii=False,
        indent=2,
    )


def run_healthcheck(*, json_output: bool = False, check_dashboard_url: bool = True) -> int:
    """CLI 진입점 — 점검 후 출력하고 종료코드를 돌려준다."""
    from .config import settings

    now = datetime.now(KST)
    env = dict(os.environ)
    engine = None
    db: RowProvider | None = None
    try:
        from sqlalchemy import create_engine

        engine = create_engine(
            settings.database_url,
            pool_size=1,
            max_overflow=0,
            connect_args={"connect_timeout": 5, "application_name": "mal-healthcheck"},
        )
        db = SqlRowProvider(engine)
    except Exception:  # noqa: BLE001 — URL 파싱 실패 등. 메시지에 URL 이 섞일 수 있어 버림.
        db = None

    dashboard = (
        (lambda: check_dashboard(env.get("DASHBOARD_URL"))) if check_dashboard_url else None
    )
    try:
        checks = collect(
            env=env, db=db, now=now, gmtoff_sec=_time.localtime().tm_gmtoff,
            dashboard=dashboard,
        )
    finally:
        if engine is not None:
            engine.dispose()

    print(render_json(checks, now) if json_output else render_table(checks, now))
    return exit_code(checks)
