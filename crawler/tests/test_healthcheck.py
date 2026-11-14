"""healthcheck — 판정(임계값·경주 캘린더) 로직 + 읽기 전용 보장 + 출력 형식.

로컬 Postgres 를 띄울 수 없는 환경(postgres 사용자 전환 불가)이라 실DB 대신 가짜
row provider(`FakeDB`) 로 `QUERIES` 이름별 결과를 주입해 판정 로직을 검증한다.
SQL 자체는 `SqlRowProvider` 가 READ ONLY 트랜잭션으로 감싸는지 + 쓰기 키워드가 없는지만
정적으로 확인한다.
"""
from __future__ import annotations

import importlib
import re
import sys
import types
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest

from src import healthcheck as hc
from src.healthcheck import KST, Check, Status

NOW = datetime(2026, 11, 6, 10, 0, tzinfo=KST)  # 금요일 10:00 KST
TODAY = NOW.date()
KST_OFF = 9 * 3600

FULL_ENV = {
    "DATABASE_URL": "postgresql://mal_app:SuperSecretPw@db:5432/app",
    "CRAWLER_SECRET": "crawler-secret-value",
    "DASHBOARD_URL": "http://crawler-dashboard:3100",
    "KRA_SERVICE_KEY": "kra-secret-value",
    "KRA_CHULMA_OPERATION": "entrySheet_2",
    "KMA_SERVICE_KEY": "kma-secret-value",
    "YOUTUBE_API_KEY": "yt-secret-value",
    "YOUTUBE_KRBC_CHANNEL_ID": "UCsecretchannel",
    "TELEGRAM_BOT_TOKEN": "tg-token-value",
    "TELEGRAM_CHAT_ID": "tg-chat-value",
    "TZ": "Asia/Seoul",
}


# ── 가짜 row provider ──────────────────────────────────────────────────────────

RaceKey = tuple[date, str, int]


def _race_days(today: date, *, back: int = 35, ahead: int = 2) -> list[date]:
    """금/토/일 (픽스처 전용 — healthcheck 자체는 요일을 모른다)."""
    out = []
    for i in range(-back, ahead + 1):
        d = today + timedelta(days=i)
        if d.weekday() in (4, 5, 6):
            out.append(d)
    return out


def _keys_for(days: list[date]) -> set[RaceKey]:
    return {(d, m, n) for d in days for m, cnt in (("서울", 3), ("부경", 2)) for n in
            range(1, cnt + 1)}


class FakeDB:
    """`QUERIES` 이름 → rows(list) / callable(**params) / Exception."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def rows(self, name: str, **params: Any) -> list[dict[str, Any]]:
        assert name in hc.QUERIES, f"정의되지 않은 쿼리 이름: {name}"
        self.calls.append((name, params))
        v = self.data.get(name, [])
        if isinstance(v, Exception):
            raise v
        if callable(v):
            v = v(**params)
        return [dict(r) for r in v]


def _key_rows(keys: set[RaceKey]) -> Callable[..., list[dict[str, Any]]]:
    def fn(*, lo: date, hi: date) -> list[dict[str, Any]]:
        return [
            {"race_date": d, "meet": m, "race_no": n}
            for d, m, n in sorted(keys) if lo <= d <= hi
        ]
    return fn


def _racing_form_healthy(now: datetime, days: list[date]) -> dict[str, Any]:
    """경마지 정상 운영 — 동결이 지난 호는 모두 발행, 지난 경주일 정산은 전부 확정."""
    from src.racing_form import definitions
    from src.racing_form.verify import EXPECTED_TRIGGERS

    today = now.date()
    r1 = definitions.get("r1")
    window = [d for d in days if abs((d - today).days) <= hc.RACING_FORM_CALENDAR_DAYS]
    meets = (("서울", 3, "11:00"), ("부경", 2, "12:00"))
    freeze = {d: datetime.combine(d - timedelta(days=1), datetime.min.time(), KST)
              + timedelta(hours=18) for d in window}
    published = [d for d in window if freeze[d] <= now]
    settle_days = [d for d in days
                   if 0 <= (today - d).days <= hc.RACING_FORM_SETTLE_LOOKBACK_DAYS]
    return {
        "racing_form_tables": [{"present": 6, "expected": 6}],
        "racing_form_rule_sets": [{
            "rules_version": "r1", "definition_sha256": definitions.definition_sha256(r1),
            "registered_at": now - timedelta(days=30),
        }],
        "racing_form_calendar": [
            {"race_date": d, "meet": m, "start_times": [t]} for d in window for m, _, t in meets
        ],
        "racing_form_editions": [
            {"race_date": d, "meet": m, "issue_no": 1, "published_at": freeze[d],
             "freeze_at": freeze[d]} for d in published for m, _, _ in meets
        ],
        "racing_form_notices": [],
        "racing_form_settlement": [
            {"edition_id": i, "race_date": d, "meet": m, "races": n,
             "final": n if d < today else 0, "open_with_results": 0}
            for i, (d, (m, n, _)) in enumerate(
                ((d, mm) for d in settle_days for mm in meets), start=1)
        ],
        "racing_form_payload": [{"editions": len(published) * 2, "bad": 0}],
        "racing_form_triggers": [
            {"name": n, "table_name": t, "enabled": "A"} for n, t in EXPECTED_TRIGGERS.items()
        ],
    }


def healthy_data(now: datetime = NOW) -> dict[str, Any]:
    """정상 운영 상태 — 직전 경주일(지난 일요일)까지 결과·파생 완비, 오늘·내일 출전표 있음."""
    today = now.date()
    days = _race_days(today)
    past = [d for d in days if d < today]
    all_keys = _keys_for(days)
    past_keys = _keys_for(past)
    last = max(past)
    utc_now = now.astimezone(UTC)
    return {
        "db_info": [{
            "db": "app", "db_user": "mal_app", "tz": "UTC", "search_path": "mal, public",
            "db_date": today, "db_kst_date": today,
        }],
        "migrations_table": [{"present": True}],
        "migrations_latest": [{
            "filename": "034_horse_ratings_snapshot_kst_backfill.sql",
            "applied_at": utc_now - timedelta(days=3), "total": 36,
        }],
        "race_bounds": [{"last_before": last, "latest": max(days)}],
        "race_keys:races": _key_rows(all_keys),
        "race_keys:race_entries": _key_rows(all_keys),
        "race_keys:race_results": _key_rows(past_keys),
        "race_keys:race_dividends": _key_rows(past_keys),
        "race_keys:race_combo_dividends": _key_rows(past_keys),
        "race_keys:race_pool_sales": _key_rows(past_keys),
        "horse_ratings": [{"latest": today - timedelta(days=6), "latest_rows": 4800}],
        "horse_rank_changes": [{
            "updated": utc_now - timedelta(hours=4), "latest_event": today - timedelta(days=2),
        }],
        "jockey_changes": [{
            "updated": utc_now - timedelta(hours=4), "latest_event": last,
        }],
        "horses_raw_null": [{"n": 12}],
        "weather_latest": [
            {"station_id": s, "latest": datetime.combine(
                today - timedelta(days=1), datetime.min.time(), KST,
            ) + timedelta(hours=23)}
            for s in (119, 184, 159)
        ],
        "videos_latest": [{
            "latest_race_date": last, "latest_matched_pub": utc_now - timedelta(days=4),
            "latest_pub": utc_now - timedelta(hours=5),
        }],
        "race_plans_years": [{"year": today.year, "n": 60}, {"year": today.year + 1, "n": 58}],
        "sync_meta": [
            {"source": "horses_backfill_not_found", "last_run_at": utc_now, "last_success_at": None,
             "has_error": False, "attempts": 10, "exhausted": 4},
            {"source": "chunked_backfill_dividends", "last_run_at": utc_now - timedelta(hours=8),
             "last_success_at": None, "has_error": False, "attempts": 0, "exhausted": 0},
            {"source": "youtube:krbc", "last_run_at": utc_now, "last_success_at": utc_now,
             "has_error": False, "attempts": 0, "exhausted": 0},
        ],
        **_racing_form_healthy(now, days),
    }


def _collect(
    data: dict[str, Any] | None = None,
    *,
    now: datetime = NOW,
    env: dict[str, str] | None = None,
    gmtoff: int = KST_OFF,
) -> list[Check]:
    return hc.collect(
        env=FULL_ENV if env is None else env,
        db=FakeDB(healthy_data(now) if data is None else data),
        now=now,
        gmtoff_sec=gmtoff,
    )


def _by_name(checks: list[Check], prefix: str) -> Check:
    """데이터/DB 점검 행 하나 (설정 행 '날씨 (sync_weather)' 등과 이름이 겹치지 않게 제외)."""
    hits = [c for c in checks if c.name.startswith(prefix) and c.area != "설정"]
    assert len(hits) == 1, f"{prefix!r}: {[c.name for c in checks]}"
    return hits[0]


# ── 전체 흐름 ───────────────────────────────────────────────────────────────────


def test_healthy_state_is_all_ok_exit_0() -> None:
    checks = _collect()
    bad = [c for c in checks if c.status != Status.OK]
    assert bad == []
    assert hc.exit_code(checks) == 0
    # 주요 영역이 모두 출력에 포함
    names = {c.name.split(" (")[0] for c in checks}
    for expected in ("다음 경주일 출전표", "직전 경주일 결과", "단승/연승 배당", "복식 배당",
                     "풀별 매출", "레이팅", "날씨", "경주 영상",
                     "대상경주 계획", "sync_meta 원장", "마이그레이션", "시간대"):
        assert expected in names, expected


def test_exit_code_rules() -> None:
    ok = Check("a", "b", Status.OK, "")
    warn = Check("a", "b", Status.WARN, "")
    fail = Check("a", "b", Status.FAIL, "")
    assert hc.exit_code([ok]) == 0
    assert hc.exit_code([ok, warn]) == 2
    assert hc.exit_code([ok, warn, fail]) == 1
    assert hc.exit_code([]) == 0


def test_db_unreachable_fails_and_skips_data_checks() -> None:
    db = FakeDB({"db_info": RuntimeError(
        'connection to server at "db" failed: postgresql://mal_app:SuperSecretPw@db/app'
    )})
    checks = hc.collect(env=FULL_ENV, db=db, now=NOW, gmtoff_sec=KST_OFF)
    conn = _by_name(checks, "연결")
    assert conn.status == Status.FAIL
    assert "SuperSecretPw" not in conn.detail  # DSN 비밀번호 마스킹
    assert _by_name(checks, "신선도").status == Status.FAIL
    assert [n for n, _ in db.calls] == ["db_info"]  # 데이터 쿼리 미실행
    assert hc.exit_code(checks) == 1


def test_one_failing_query_does_not_block_others() -> None:
    data = healthy_data()
    data["weather_latest"] = RuntimeError('relation "weather_observations" does not exist')
    checks = _collect(data)
    weather = _by_name(checks, "날씨")
    assert weather.status == Status.FAIL
    assert "does not exist" in weather.detail
    assert _by_name(checks, "경주 영상").status == Status.OK


def test_missing_migrations_table_is_warn() -> None:
    data = healthy_data()
    data["migrations_table"] = [{"present": False}]
    c = _by_name(_collect(data), "마이그레이션")
    assert c.status == Status.WARN


def test_db_kst_clock_mismatch_is_warn() -> None:
    data = healthy_data()
    data["db_info"][0]["db_kst_date"] = TODAY - timedelta(days=1)
    assert _by_name(_collect(data), "시간대").status == Status.WARN


# ── 1. 설정 ─────────────────────────────────────────────────────────────────────


def test_config_never_prints_values() -> None:
    checks = hc.check_config(FULL_ENV, gmtoff_sec=KST_OFF)
    assert all(c.status == Status.OK for c in checks)
    text = hc.render_table(checks, NOW) + hc.render_json(checks, NOW)
    for name, value in FULL_ENV.items():
        if name == "TZ":
            continue
        assert value not in text, name
    assert "KRA_SERVICE_KEY 있음" in text


def test_config_missing_vars_severity() -> None:
    env = {k: v for k, v in FULL_ENV.items()
           if k not in {"KRA_CHULMA_OPERATION", "TELEGRAM_CHAT_ID"}}
    env["YOUTUBE_API_KEY"] = "   "  # 공백만 = 없음
    checks = {c.name.split(" (")[0]: c for c in hc.check_config(env, gmtoff_sec=KST_OFF)}
    assert checks["출전표"].status == Status.FAIL
    assert "KRA_CHULMA_OPERATION 없음" in checks["출전표"].detail
    assert checks["영상"].status == Status.FAIL
    assert "YOUTUBE_API_KEY 없음" in checks["영상"].detail
    assert "YOUTUBE_KRBC_CHANNEL_ID 있음" in checks["영상"].detail
    assert checks["실패 알림"].status == Status.WARN  # Telegram 은 선택
    assert checks["날씨"].status == Status.OK


def test_config_kra_overrides_only_is_warn() -> None:
    env = {k: v for k, v in FULL_ENV.items() if k != "KRA_SERVICE_KEY"}
    env["KRA_SERVICE_KEY_RACE_RESULT"] = "x"
    kra = next(c for c in hc.check_config(env, gmtoff_sec=KST_OFF)
               if c.name.startswith("KRA OpenAPI"))
    assert kra.status == Status.WARN
    env.pop("KRA_SERVICE_KEY_RACE_RESULT")
    kra = next(c for c in hc.check_config(env, gmtoff_sec=KST_OFF)
               if c.name.startswith("KRA OpenAPI"))
    assert kra.status == Status.FAIL


def test_config_process_tz_not_kst_fails() -> None:
    env = {k: v for k, v in FULL_ENV.items() if k != "TZ"}
    tz = next(c for c in hc.check_config(env, gmtoff_sec=0) if c.name == "프로세스 시간대")
    assert tz.status == Status.FAIL
    assert "UTC+0" in tz.detail


# ── 3. 경주 캘린더 ──────────────────────────────────────────────────────────────


def _drop(keys_fn: Callable[..., list[dict[str, Any]]], pred: Callable[[dict], bool]):
    def fn(**params: Any) -> list[dict[str, Any]]:
        return [r for r in keys_fn(**params) if not pred(r)]
    return fn


def test_next_race_day_today_missing_entries_fails() -> None:
    data = healthy_data()
    data["race_keys:race_entries"] = _drop(
        data["race_keys:race_entries"], lambda r: r["race_date"] == TODAY and r["meet"] == "부경",
    )
    c = _by_name(_collect(data), "다음 경주일 출전표")
    assert c.status == Status.FAIL
    assert "출전표 3/5" in c.detail


def test_next_race_day_future_missing_entries_warns() -> None:
    now = datetime(2026, 11, 5, 10, 0, tzinfo=KST)  # 목요일 — 다음 경주일은 내일
    data = healthy_data(now)
    data["race_keys:race_entries"] = _drop(
        data["race_keys:race_entries"], lambda r: r["race_date"] == date(2026, 11, 6),
    )
    # races 스켈레톤만 남은 상태 (출전표 0)
    c = _by_name(_collect(data, now=now), "다음 경주일 출전표")
    assert c.status == Status.WARN


@pytest.mark.parametrize(
    ("today", "expected"),
    [
        (date(2026, 11, 3), Status.OK),  # 화 — 직전 일요일로부터 2일
        (date(2026, 11, 5), Status.WARN),  # 목 — 4일, 금요일 출전표가 와 있어야 함
        (date(2026, 11, 12), Status.FAIL),  # 10일 — 휴장 아니면 entries 잡 정지
    ],
)
def test_next_race_day_no_upcoming_gap_thresholds(today: date, expected: Status) -> None:
    last = date(2026, 11, 1)  # 일요일
    now = datetime.combine(today, datetime.min.time(), KST) + timedelta(hours=10)
    days = [d for d in _race_days(today, ahead=0) if d <= last]
    keys = _keys_for(days)
    data = healthy_data(now)
    data.update({
        "race_bounds": [{"last_before": last, "latest": last}],
        "race_keys:races": _key_rows(keys),
        "race_keys:race_entries": _key_rows(keys),
        "race_keys:race_results": _key_rows(keys),
    })
    c = _by_name(_collect(data, now=now), "다음 경주일 출전표")
    assert c.status == expected, c.detail


def test_weekly_pattern_flags_vanished_race_day() -> None:
    """지난주 금요일엔 경주가 있었는데 오늘(금) races·출전표·결과가 전무 → WARN."""
    data = healthy_data()
    for t in ("races", "race_entries"):
        data[f"race_keys:{t}"] = _drop(data[f"race_keys:{t}"], lambda r: r["race_date"] == TODAY)
    checks = _collect(data)
    c = _by_name(checks, "경주일 누락")
    assert c.status == Status.WARN
    assert TODAY.isoformat() in c.detail
    # 내일(토) 출전표는 있으므로 다음 경주일은 정상
    assert _by_name(checks, "다음 경주일 출전표").status == Status.OK


def test_weekly_pattern_holiday_extra_day_is_not_flagged() -> None:
    """공휴일 월요일 추가 개최 — 다음 주 월요일이 비어도 지난주 패턴이라 경고하나,
    추가 개최일 자체(지난주 같은 요일 없음)는 문제 삼지 않는다."""
    data = healthy_data()
    extra = TODAY - timedelta(days=4)  # 월요일 (공휴일 개최 가정)
    keys = _keys_for(_race_days(TODAY)) | _keys_for([extra])
    data["race_keys:races"] = _key_rows(keys)
    data["race_keys:race_entries"] = _key_rows(keys)
    data["race_keys:race_results"] = _key_rows({k for k in keys if k[0] < TODAY})
    assert _by_name(_collect(data), "경주일 누락").status == Status.OK


# ── 결과 ────────────────────────────────────────────────────────────────────────

SAT = datetime(2026, 11, 7, 10, 0, tzinfo=KST)  # 토 10:00 — 직전 경주일 = 어제(금)


def test_yesterday_results_all_missing_fails() -> None:
    data = healthy_data(SAT)
    fri = date(2026, 11, 6)
    for t in ("race_results", "race_dividends", "race_combo_dividends", "race_pool_sales"):
        data[f"race_keys:{t}"] = _drop(data[f"race_keys:{t}"], lambda r: r["race_date"] == fri)
    checks = _collect(data, now=SAT)
    c = _by_name(checks, "직전 경주일 결과")
    assert c.status == Status.FAIL
    assert "sync-race-date 2026-11-06" in c.detail
    # 결과가 없으면 파생 테이블은 판정 보류(WARN), FAIL 중복 없음
    assert _by_name(checks, "단승/연승 배당").status == Status.WARN
    assert hc.exit_code(checks) == 1


def test_yesterday_results_partial_before_residual_deadline_warns() -> None:
    fri = date(2026, 11, 6)
    data = healthy_data(SAT)
    data["race_keys:race_results"] = _drop(
        data["race_keys:race_results"], lambda r: r["race_date"] == fri and r["race_no"] == 3,
    )
    c = _by_name(_collect(data, now=SAT), "직전 경주일 결과")
    assert c.status == Status.WARN
    assert "residual" in c.detail
    late = SAT.replace(hour=13)
    c = _by_name(_collect(data, now=late), "직전 경주일 결과")
    assert c.status == Status.WARN
    assert "1경주 결과 없음" in c.detail


def test_today_results_checked_only_late_evening() -> None:
    data = healthy_data()  # 오늘(금) 결과 없음
    assert not [c for c in _collect(data) if c.name == "오늘 결과"]
    late = NOW.replace(hour=23, minute=40)
    c = _by_name(_collect(healthy_data(late), now=late), "오늘 결과")
    assert c.status == Status.WARN


def test_results_invariant_counts_old_orphans() -> None:
    data = healthy_data()
    old = date(2026, 10, 24)  # 2주 전 토요일 (직전 경주일 이전)
    data["race_keys:race_results"] = _drop(
        data["race_keys:race_results"], lambda r: r["race_date"] == old and r["meet"] == "서울",
    )
    c = _by_name(_collect(data), "출전표 있고 결과 없음")
    assert c.status == Status.WARN
    assert c.detail.startswith("3경주")
    assert old.isoformat() in c.detail


def test_meet_alias_busan_is_normalized() -> None:
    """한 테이블이 '부산경남' 으로 적재돼도 '부경' 과 같은 경주로 본다."""
    data = healthy_data()
    base = data["race_keys:race_dividends"]

    def aliased(**params: Any) -> list[dict[str, Any]]:
        return [{**r, "meet": "부산경남" if r["meet"] == "부경" else r["meet"]}
                for r in base(**params)]

    data["race_keys:race_dividends"] = aliased
    assert _by_name(_collect(data), "단승/연승 배당").status == Status.OK


@pytest.mark.parametrize(
    ("table", "label", "zero"),
    [
        ("race_dividends", "단승/연승 배당", Status.FAIL),
        ("race_combo_dividends", "복식 배당", Status.FAIL),
        ("race_pool_sales", "풀별 매출", Status.FAIL),
    ],
)
def test_last_day_coverage(table: str, label: str, zero: Status) -> None:
    last = date(2026, 11, 1)
    data = healthy_data()
    data[f"race_keys:{table}"] = _drop(
        data[f"race_keys:{table}"], lambda r: r["race_date"] == last and r["race_no"] == 1,
    )
    c = _by_name(_collect(data), label)
    assert c.status == Status.WARN
    assert "2/5경주" in c.detail.replace(" ", "") or "3/5경주" in c.detail

    data[f"race_keys:{table}"] = _drop(data[f"race_keys:{table}"], lambda r: r["race_date"] == last)
    c = _by_name(_collect(data), label)
    assert c.status == zero


# ── 그 외 신선도 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("age", "expected"), [(8, Status.OK), (9, Status.WARN), (16, Status.FAIL)],
)
def test_horse_ratings_age(age: int, expected: Status) -> None:
    data = healthy_data()
    data["horse_ratings"] = [{"latest": TODAY - timedelta(days=age), "latest_rows": 1}]
    assert _by_name(_collect(data), "레이팅").status == expected


def test_horse_ratings_empty_fails() -> None:
    data = healthy_data()
    data["horse_ratings"] = [{"latest": None, "latest_rows": 0}]
    assert _by_name(_collect(data), "레이팅").status == Status.FAIL


@pytest.mark.parametrize(
    ("hours", "rank", "jockey"),
    [(4, Status.OK, Status.OK), (40, Status.WARN, Status.WARN),
     (80, Status.FAIL, Status.WARN), (24 * 15, Status.FAIL, Status.FAIL)],
)
def test_change_tables_recency(hours: int, rank: Status, jockey: Status) -> None:
    data = healthy_data()
    upd = NOW.astimezone(UTC) - timedelta(hours=hours)
    data["horse_rank_changes"] = [{"updated": upd, "latest_event": TODAY}]
    data["jockey_changes"] = [{"updated": upd, "latest_event": TODAY}]
    checks = _collect(data)
    assert _by_name(checks, "등급변동").status == rank
    assert _by_name(checks, "기수변경").status == jockey


def test_horses_raw_null_unresolved_warns() -> None:
    data = healthy_data()
    data["horses_raw_null"] = [{"n": 300}]
    c = _by_name(_collect(data), "마필 raw NULL")
    assert c.status == Status.WARN
    assert "원장 10" in c.detail and "exhausted 4" in c.detail and "미분류 290" in c.detail


def _weather(latest: dict[int, datetime | None]) -> list[dict[str, Any]]:
    return [{"station_id": s, "latest": t} for s, t in latest.items() if t is not None]


def _obs(d: date, hour: int = 23) -> datetime:
    return datetime.combine(d, datetime.min.time(), KST) + timedelta(hours=hour)


@pytest.mark.parametrize(
    ("now", "days_back", "expected"),
    [
        (NOW, 1, Status.OK),  # 10:00 — 어제까지 있음
        (NOW, 2, Status.OK),  # 전날 관측은 정오 무렵 확정 → 그저께까지면 정상
        (NOW, 3, Status.WARN),  # 하루 지연
        (NOW, 4, Status.FAIL),
        (NOW.replace(hour=2), 3, Status.OK),  # 03:00 잡 전에는 D-3 까지면 정상
    ],
)
def test_weather_freshness(now: datetime, days_back: int, expected: Status) -> None:
    data = healthy_data(now)
    d = now.date() - timedelta(days=days_back)
    data["weather_latest"] = _weather({119: _obs(d), 184: _obs(d), 159: _obs(d)})
    assert _by_name(_collect(data, now=now), "날씨").status == expected


def test_weather_missing_station_fails() -> None:
    data = healthy_data()
    y = TODAY - timedelta(days=1)
    data["weather_latest"] = _weather({119: _obs(y), 184: _obs(y)})
    c = _by_name(_collect(data), "날씨")
    assert c.status == Status.FAIL
    assert "159:없음" in c.detail


@pytest.mark.parametrize(
    ("matched", "expected"),
    [
        (date(2026, 11, 1), Status.OK),  # 직전 경주일과 같음
        (date(2026, 10, 31), Status.WARN),
        (date(2026, 10, 18), Status.FAIL),
        (None, Status.FAIL),
    ],
)
def test_videos_recency(matched: date | None, expected: Status) -> None:
    data = healthy_data()
    data["videos_latest"] = [{
        "latest_race_date": matched, "latest_matched_pub": None, "latest_pub": None,
    }]
    assert _by_name(_collect(data), "경주 영상").status == expected


@pytest.mark.parametrize(
    ("now", "rows", "expected"),
    [
        (NOW, [{"year": 2026, "n": 60}], Status.WARN),  # 11월 — 내년 계획 없음
        (NOW, [{"year": 2026, "n": 60}, {"year": 2027, "n": 3}], Status.OK),
        (NOW.replace(month=10, day=9), [{"year": 2026, "n": 60}], Status.OK),  # 10월엔 안 봄
        (NOW.replace(month=10, day=9), [], Status.FAIL),
        (NOW.replace(month=1, day=9), [], Status.WARN),  # 1월은 올해 미공개 허용
    ],
)
def test_race_plans(now: datetime, rows: list[dict[str, Any]], expected: Status) -> None:
    data = healthy_data(now)
    data["race_plans_years"] = rows
    c = _by_name(_collect(data, now=now), "대상경주 계획")
    assert c.status == expected, c.detail


def test_ledgers_exhausted_and_errors_warn() -> None:
    data = healthy_data()
    data["sync_meta"][1].update({"attempts": 5, "exhausted": 2})
    data["sync_meta"][2]["has_error"] = True
    c = _by_name(_collect(data), "sync_meta 원장")
    assert c.status == Status.WARN
    assert "exhausted 2" in c.detail
    assert "youtube:krbc" in c.detail


def test_ledgers_exhausted_only_is_info() -> None:
    """exhausted gap 은 설계상 상시 존재 — 오류가 없으면 OK (exit 2 상시화 방지)."""
    data = healthy_data()
    data["sync_meta"][1].update({"attempts": 5, "exhausted": 2})
    c = _by_name(_collect(data), "sync_meta 원장")
    assert c.status == Status.OK
    assert "exhausted 2" in c.detail


# ── 4. 대시보드 ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("handler", "expected"),
    [
        (lambda req: httpx.Response(200), Status.OK),
        (lambda req: httpx.Response(401), Status.OK),  # 닿기만 하면 됨
        (lambda req: httpx.Response(503), Status.WARN),
    ],
)
def test_dashboard_http(handler: Callable, expected: Status) -> None:
    c = hc.check_dashboard("http://crawler-dashboard:3100", transport=httpx.MockTransport(handler))
    assert c.status == expected
    assert "crawler-dashboard:3100" not in c.detail


def test_dashboard_unreachable_and_unset_warn_only() -> None:
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timeout", request=req)

    c = hc.check_dashboard("http://x:1", transport=httpx.MockTransport(boom))
    assert c.status == Status.WARN
    assert hc.check_dashboard(None).status == Status.WARN

    checks = hc.collect(
        env=FULL_ENV, db=FakeDB(healthy_data()), now=NOW, gmtoff_sec=KST_OFF,
        dashboard=lambda: hc.check_dashboard(
            "http://x:1", transport=httpx.MockTransport(boom),
        ),
    )
    assert hc.exit_code(checks) == 2  # 대시보드만 실패 → WARN


# ── 읽기 전용 보장 ──────────────────────────────────────────────────────────────


_WRITE_RE = re.compile(
    r"\b(insert|update|delete|merge|upsert|alter|drop|create|truncate|grant|revoke|copy|vacuum|"
    r"lock|call|do)\b",
    re.IGNORECASE,
)


def test_queries_have_no_write_statements() -> None:
    for name, sql in hc.QUERIES.items():
        # 컬럼명 updated_at / last_run_at 같은 식별자는 단어 경계상 걸리지 않는다
        stripped = re.sub(r"\b\w+_\w+\b", "", sql)
        assert not _WRITE_RE.search(stripped), name
        assert sql.lstrip().upper().startswith(("SELECT", "WITH")), name


class _FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def __iter__(self):
        return iter(types.SimpleNamespace(_mapping=r) for r in self._rows)


class _FakeConn:
    def __init__(self, log: list[str]) -> None:
        self.log = log

    def __enter__(self) -> _FakeConn:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.log.append("close")

    def begin(self) -> Any:
        self.log.append("begin")
        return types.SimpleNamespace(rollback=lambda: self.log.append("rollback"))

    def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        self.log.append(str(stmt).strip().split("\n")[0])
        return _FakeResult([{"n": 1}])


def test_sql_provider_wraps_every_query_in_read_only_txn() -> None:
    log: list[str] = []
    engine = types.SimpleNamespace(connect=lambda: _FakeConn(log))
    rows = hc.SqlRowProvider(engine).rows("horses_raw_null")
    assert rows == [{"n": 1}]
    assert log[0] == "begin"
    assert log[1] == "SET TRANSACTION READ ONLY"
    assert log[2].startswith("SET LOCAL statement_timeout")
    assert log[3].startswith("SET LOCAL lock_timeout")
    assert log[-2:] == ["rollback", "close"]
    assert "commit" not in log


def test_sql_provider_rolls_back_on_error() -> None:
    log: list[str] = []

    class Boom(_FakeConn):
        def execute(self, stmt: Any, params: dict[str, Any] | None = None) -> _FakeResult:
            if "horses" in str(stmt):
                raise RuntimeError("boom")
            return super().execute(stmt, params)

    engine = types.SimpleNamespace(connect=lambda: Boom(log))
    with pytest.raises(RuntimeError):
        hc.SqlRowProvider(engine).rows("horses_raw_null")
    assert "rollback" in log


# ── 출력 ────────────────────────────────────────────────────────────────────────


def test_render_table_aligns_korean_columns() -> None:
    checks = _collect()
    out = hc.render_table(checks, NOW)
    lines = out.splitlines()
    assert lines[0].startswith("mal-crawler healthcheck · 2026-11-06(금) 10:00 KST")
    assert lines[-1] == f"요약: OK {len(checks)} · WARN 0 · FAIL 0 → exit 0"
    # 내용 열 시작 위치(표시 폭)가 모든 행에서 같다
    body = lines[3:-1]
    starts = set()
    for line, c in zip(body, checks, strict=True):
        idx = line.index(c.detail)
        starts.add(hc._width(line[:idx]))
    assert len(starts) == 1


def test_render_json_roundtrip() -> None:
    import json

    checks = [Check("설정", "x", Status.WARN, "y")]
    payload = json.loads(hc.render_json(checks, NOW))
    assert payload["exit_code"] == 2
    assert payload["checks"] == [{"area": "설정", "name": "x", "status": "WARN", "detail": "y"}]


# ── CLI 연결 ────────────────────────────────────────────────────────────────────


@pytest.fixture
def main_module(monkeypatch: pytest.MonkeyPatch) -> Any:
    # crawler_core(sibling 레포) 는 테스트 환경에 없을 수 있어 가짜 모듈로 대체.
    client = types.SimpleNamespace(
        safe_register=lambda **kw: None,
        safe_start_run=lambda job_key: None,
        safe_finish_run=lambda run_id, **kw: None,
        poll_and_dispatch=lambda jobs: None,
    )
    pkg = types.ModuleType("crawler_core")
    pkg.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crawler_core", pkg)
    monkeypatch.setitem(sys.modules, "crawler_core.client", client)  # type: ignore[arg-type]
    for mod in ("src.monitoring", "src.jobs.periodic", "src.main"):
        monkeypatch.delitem(sys.modules, mod, raising=False)
    return importlib.import_module("src.main")


@pytest.mark.parametrize("code", [0, 1, 2])
def test_cli_healthcheck_exit_code(
    main_module: Any, monkeypatch: pytest.MonkeyPatch, code: int,
) -> None:
    from typer.testing import CliRunner

    seen: dict[str, Any] = {}

    def fake_run(**kw: Any) -> int:
        seen.update(kw)
        return code

    monkeypatch.setattr(hc, "run_healthcheck", fake_run)
    result = CliRunner().invoke(main_module.app, ["healthcheck", "--json", "--no-dashboard"])
    assert result.exit_code == code
    assert seen == {"json_output": True, "check_dashboard_url": False}


# ── 경마지 (racing form) ────────────────────────────────────────────────────────

_RF_ROWS = ("경마지 발행", "경마지 정산", "경마지 보호 장치")


def _rf(checks: list[Check]) -> dict[str, Check]:
    out = {c.name: c for c in checks if c.area == "경마지"}
    assert set(out) == set(_RF_ROWS), [c.name for c in checks if c.area == "경마지"]
    return out


def _rf_check(data: dict[str, Any], now: datetime = NOW) -> dict[str, Check]:
    return _rf(hc.check_data(FakeDB(data), now))


def _at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hh, mm, tzinfo=KST)


def test_racing_form_queries_take_time_as_params_not_db_clock() -> None:
    rf = {k: v for k, v in hc.QUERIES.items() if k.startswith("racing_form_")}
    assert len(rf) >= 6
    for name, sql in rf.items():
        assert "now()" not in sql.lower() and "current_date" not in sql.lower(), name


def test_racing_form_healthy_rows_ok() -> None:
    rows = _rf_check(healthy_data())
    assert all(c.status == Status.OK for c in rows.values()), rows
    # 창 [10-30, 11-13] 중 동결이 지난 10-30·10-31·11-01·11-06 × 2 경마장, 11-07·11-08 대기
    assert "달력 12호 · 발행 8 · 대기 4" in rows["경마지 발행"].detail
    assert "트리거 12개 ALWAYS" in rows["경마지 보호 장치"].detail


def test_racing_form_migration_missing_warns_before_launch() -> None:
    data = healthy_data()
    data["racing_form_tables"] = [{"present": 0, "expected": 6}]
    rows = _rf_check(data)
    assert {c.status for c in rows.values()} == {Status.WARN}
    assert all("036 미적용" in c.detail for c in rows.values())


def test_racing_form_no_rule_set_is_pre_launch_warn() -> None:
    data = healthy_data()
    data["racing_form_rule_sets"] = []
    rows = _rf_check(data)
    assert rows["경마지 발행"].status == Status.WARN
    assert "운영 전" in rows["경마지 발행"].detail
    assert rows["경마지 정산"].status == Status.WARN
    assert rows["경마지 보호 장치"].status == Status.OK  # 트리거·해시는 출시 전에도 본다


def _drop_edition(data: dict[str, Any], d: date, meet: str) -> None:
    data["racing_form_editions"] = [
        e for e in data["racing_form_editions"] if (e["race_date"], e["meet"]) != (d, meet)]


@pytest.mark.parametrize(
    ("hh", "mm", "status", "text"),
    [
        (18, 30, Status.OK, "동결 전"),  # freeze + 30분 — 아직 경고 아님
        (18, 40, Status.WARN, "+ 35분 미발행"),
        (20, 10, Status.FAIL, "+ 125분 미발행"),
    ],
)
def test_racing_form_publish_late_thresholds(
    hh: int, mm: int, status: Status, text: str,
) -> None:
    # D = 11-07(토) 서울 — 동결 11-06(금) 18:00
    now = _at(TODAY, hh, mm)
    data = healthy_data(now)
    _drop_edition(data, TODAY + timedelta(days=1), "서울")
    row = _rf_check(data, now)["경마지 발행"]
    assert row.status == status, row
    if status != Status.OK:
        assert text in row.detail and "서울" in row.detail
    else:
        assert "대기 3" in row.detail  # 11-07 서울(동결 직후) + 11-08 두 호(동결 전)


def test_racing_form_publish_past_deadline_without_missed_fails() -> None:
    # NOW = 11-06 10:00 — 11-06 서울 마감 08:00 (첫 발주 11:00 − 60분 = 10:00 보다 이름) + 30분 지남
    data = healthy_data()
    _drop_edition(data, TODAY, "서울")
    row = _rf_check(data)["경마지 발행"]
    assert row.status == Status.FAIL
    assert "발행본·missed 모두 없음" in row.detail


def test_racing_form_publish_missed_recorded_warns_for_three_days() -> None:
    data = healthy_data()
    _drop_edition(data, TODAY, "서울")
    data["racing_form_notices"] = [{
        "kind": "missed", "race_date": TODAY, "meet": "서울", "until": None,
        "noticed_at": _at(TODAY, 8, 0),
    }]
    row = _rf_check(data)["경마지 발행"]
    assert row.status == Status.WARN and "missed" in row.detail
    later = NOW + timedelta(days=4)
    data_later = healthy_data(later)
    _drop_edition(data_later, TODAY, "서울")
    data_later["racing_form_notices"] = data["racing_form_notices"]
    assert _rf_check(data_later, later)["경마지 발행"].status == Status.OK


def test_racing_form_publish_skips_paused_and_pre_launch() -> None:
    data = healthy_data()
    _drop_edition(data, TODAY, "서울")
    data["racing_form_notices"] = [{
        "kind": "paused", "race_date": TODAY - timedelta(days=1), "meet": None,
        "until": TODAY.isoformat(), "noticed_at": NOW - timedelta(days=2),
    }]
    row = _rf_check(data)["경마지 발행"]
    assert row.status == Status.OK and "제외(출시 전·쉼)" in row.detail

    data = healthy_data()
    _drop_edition(data, TODAY, "서울")
    # 출시(첫 등록)가 이 호의 동결(11-05 18:00) 뒤 → missed 로 세지 않는다
    data["racing_form_rule_sets"][0]["registered_at"] = _at(TODAY, 9, 0)
    assert _rf_check(data)["경마지 발행"].status == Status.OK


def _settle_rows(d: date, races: int, final: int, with_results: int) -> list[dict[str, Any]]:
    return [{"edition_id": 1, "race_date": d, "meet": "서울", "races": races, "final": final,
             "open_with_results": with_results}]


def test_racing_form_settle_thresholds() -> None:
    d = date(2026, 10, 31)  # 토
    data = healthy_data()
    data["racing_form_settlement"] = _settle_rows(d, 3, 3, 0)
    assert _rf_check(data)["경마지 정산"].status == Status.OK

    # D+1 13:00 확정 직후는 정상, 13:30 지나면 경고
    for now, status in ((_at(d + timedelta(days=1), 13, 20), Status.OK),
                        (_at(d + timedelta(days=1), 13, 40), Status.WARN)):
        data = healthy_data(now)
        data["racing_form_settlement"] = _settle_rows(d, 3, 1, 2)
        assert _rf_check(data, now)["경마지 정산"].status == status, now

    # D+2 13:30 이후: 결과 행이 있으면 실패, 없으면(결과 미공표) 경고
    data = healthy_data()
    data["racing_form_settlement"] = _settle_rows(d, 3, 2, 1)
    row = _rf_check(data)["경마지 정산"]
    assert row.status == Status.FAIL and "결과 행 있음 1" in row.detail
    data["racing_form_settlement"] = _settle_rows(d, 3, 2, 0)
    row = _rf_check(data)["경마지 정산"]
    assert row.status == Status.WARN and "결과 행 없음" in row.detail


def test_racing_form_guard_failures() -> None:
    data = healthy_data()
    data["racing_form_payload"] = [{"editions": 4, "bad": 1}]
    row = _rf_check(data)["경마지 보호 장치"]
    assert row.status == Status.FAIL and "payload 해시" in row.detail

    data = healthy_data()
    data["racing_form_triggers"] = data["racing_form_triggers"][1:]
    row = _rf_check(data)["경마지 보호 장치"]
    assert row.status == Status.FAIL and "11/12" in row.detail

    data = healthy_data()
    data["racing_form_triggers"][0]["enabled"] = "O"  # ENABLE (ORIGIN) — replica 에서 꺼짐
    row = _rf_check(data)["경마지 보호 장치"]
    assert row.status == Status.FAIL and "ALWAYS 아님" in row.detail

    data = healthy_data()
    data["racing_form_rule_sets"][0]["definition_sha256"] = "0" * 64
    row = _rf_check(data)["경마지 보호 장치"]
    assert row.status == Status.FAIL and "r1 해시" in row.detail

    data = healthy_data()
    data["racing_form_rule_sets"].append({
        "rules_version": "r9", "definition_sha256": "1" * 64, "registered_at": NOW,
    })
    row = _rf_check(data)["경마지 보호 장치"]
    assert row.status == Status.FAIL and "r9" in row.detail


def test_racing_form_query_error_fails_only_that_row() -> None:
    data = healthy_data()
    data["racing_form_calendar"] = RuntimeError("relation does not exist")
    rows = _rf_check(data)
    assert rows["경마지 발행"].status == Status.FAIL
    assert "점검 실패" in rows["경마지 발행"].detail
    assert rows["경마지 정산"].status == Status.OK
    assert rows["경마지 보호 장치"].status == Status.OK
