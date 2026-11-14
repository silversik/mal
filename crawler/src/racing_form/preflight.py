"""경마지 출시 전 읽기 전용 감사 — `racing-form-preflight` (계획 §9.5, 방향 문서 9.7 의 18개 항목).

- 자체 쿼리 dict `QUERIES` + 작은 provider `SqlRows` (healthcheck.QUERIES 에 넣지 않는다 —
  healthcheck 의 SqlRowProvider 는 그 dict 에 묶여 있다).
- 쿼리마다 트랜잭션 하나: `SET TRANSACTION READ ONLY` → `SET LOCAL statement_timeout` 15초 ·
  `lock_timeout` 2초 → 실행 → rollback. 쿼리는 SELECT·WITH·EXPLAIN(ANALYZE 없음)만이다.
- 한 항목이 실패(시간 초과 등)해도 그 항목만 FAIL 로 남기고 다른 항목은 계속한다.
- 상태: OK(기준 충족) · INFO(판단용 수치) · WARN(사전 등록·게이트에서 결정할 신호) · FAIL(점검
  실패 또는 출시 불가 조건). 종료 코드는 FAIL 이 있으면 1, 아니면 0 (WARN 은 사람이 판단).
- 백업 TOC 확인은 호스트 명령이라 실행하지 않고 명령만 출력한다 (`BACKUP_TOC_COMMAND`).
- 현재 시각을 읽지 않는다 — now 는 인자 (CLI 가 KST 로 넘긴다). SQL 에도 NOW() 를 쓰지 않는다.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Protocol

from sqlalchemy import text

from ..redact import redact
from . import definitions, parse, queries, schedule
from .definitions import RuleSetDef
from .schedule import KST

STATEMENT_TIMEOUT_MS = 15_000
LOCK_TIMEOUT_MS = 2_000

#: 대부분의 항목이 보는 기간 — 오늘 − 3년 (워밍업 2024 · dev 2025 · holdout 2026)
LOOKBACK_DAYS = 3 * 366
#: 출전표 계열 항목이 보는 기간 — 최근 8주
RECENT_DAYS = 56

#: 사전 등록한 과거 시험 기간 (계획 §5.5)
DEV_PERIOD = (date(2025, 1, 1), date(2025, 12, 31))
HOLDOUT_PERIOD = (date(2026, 1, 1), date(2026, 10, 31))

#: 게이트 ⑤ — 출전표 rating ↔ 결과 hrRating 일치율
RATING_MATCH_MIN_PCT = 95
#: 게이트 ③ — 참여율 (rating·form·jockey)
PARTICIPATION_MIN_PCT = 70
#: 파싱 실패율 경고 (값이 있는 행 중)
PARSE_FAIL_WARN_PCT = 1
#: EXPLAIN Q2 가 race_results 를 Seq Scan 하면 경고할 테이블 크기 (추정 행 수)
SEQ_SCAN_WARN_ROWS = 50_000

BACKUP_TOC_COMMAND = (
    'pg_restore --list <덤프 파일> | grep -E "FUNCTION mal racing_form|TRIGGER mal"'
)
BACKUP_TOC_NOTE = (
    "백업 확인은 호스트에서 직접: racing_form 함수 3개와 trg_rf_ 트리거 12개가 보여야 한다 — "
    + BACKUP_TOC_COMMAND
)

OK, INFO, WARN, FAIL = "OK", "INFO", "WARN", "FAIL"
STATUSES = (OK, INFO, WARN, FAIL)

_CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱"
_WEEKDAY_KO = "월화수목금토일"

#: 출주 판정 (계약 §1.1) — features.classify_start 와 같다
_STARTED = "COALESCE(rr.rank >= 1 OR round(rr.record_time * 10) > 0, FALSE)"
#: 양의 정수 문자열 ("65" · "065" · "65.0")
_POS_INT = r"'^0*[1-9][0-9]*(\.0*)?$'"

# ---------------------------------------------------------------------------
# 쿼리 (이름 → SQL). SELECT·WITH·EXPLAIN 만 — 쓰기 키워드 금지 (테스트가 막는다)
# ---------------------------------------------------------------------------

QUERIES: dict[str, str] = {
    # ① 출주 분류 · 착순 없는 행의 raw 표식
    "q01_classes": """
        SELECT CASE WHEN rr.rank >= 1 THEN 'ranked'
                    WHEN round(rr.record_time * 10) > 0 THEN 'unranked_timed'
                    ELSE 'no_rank_no_time' END AS cls,
               (rr.rank IS NULL) AS rank_null,
               COUNT(*)::int AS n
          FROM race_results rr
         WHERE rr.race_date >= :since
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    "q01_samples": """
        SELECT rr.raw ->> 'ord'    AS ord,
               rr.raw ->> 'stOrd'  AS st_ord,
               rr.raw ->> 'rcTime' AS rc_time,
               rr.raw ->> 'differ' AS differ,
               (rr.record_time IS NOT NULL) AS has_time,
               COUNT(*)::int AS n,
               MAX(rr.race_date) AS last_date
          FROM race_results rr
         WHERE rr.race_date >= :since
           AND (rr.rank IS NULL OR rr.rank <= 0)
         GROUP BY 1, 2, 3, 4, 5
         ORDER BY n DESC, last_date DESC
         LIMIT 20
    """,
    # ② stale 판정 vs 실제 미출주 (결과가 있는 경주일만)
    "q02_stale": f"""
        WITH e AS (
            SELECT e.race_date, e.meet, e.race_no, e.horse_no, e.updated_at,
                   MAX(e.updated_at) OVER (PARTITION BY e.race_date, e.meet) AS batch_at
              FROM race_entries e
             WHERE e.race_date >= :lo
               AND e.race_date < :today
        )
        SELECT (e.updated_at < e.batch_at - (:tol * interval '1 minute')) AS stale,
               EXISTS (
                   SELECT 1 FROM race_results rr
                    WHERE rr.race_date = e.race_date AND rr.meet = e.meet
                      AND rr.race_no = e.race_no AND rr.horse_no = e.horse_no
                      AND {_STARTED}) AS started,
               COUNT(*)::int AS n
          FROM e
         WHERE EXISTS (SELECT 1 FROM race_results x
                        WHERE x.race_date = e.race_date AND x.meet = e.meet)
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    # ③ 출전표 rating ↔ 결과 hrRating (같은 경주·같은 말)
    "q03_rating_pairs": """
        SELECT e.meet,
               e.rating               AS entry_rating,
               e.raw ->> 'hrRating'   AS entry_raw,
               rr.raw ->> 'hrRating'  AS result_raw,
               COUNT(*)::int AS n
          FROM race_entries e
          JOIN race_results rr
            ON rr.race_date = e.race_date AND rr.meet = e.meet
           AND rr.race_no = e.race_no AND rr.horse_no = e.horse_no
         WHERE e.race_date >= :since
         GROUP BY 1, 2, 3, 4
    """,
    # ④ 연도별 jkNo 보유율 · 동명이인
    "q04_jk_years": """
        SELECT EXTRACT(YEAR FROM rr.race_date)::int AS year,
               rr.meet,
               COUNT(*)::int AS n,
               COUNT(*) FILTER (
                   WHERE NULLIF(ltrim(btrim(rr.raw ->> 'jkNo'), '0'), '') IS NOT NULL)::int
                   AS with_jk_no
          FROM race_results rr
         WHERE rr.race_date >= :since
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    "q04_homonyms": """
        SELECT rr.meet,
               btrim(rr.jockey_name) AS name,
               COUNT(DISTINCT NULLIF(ltrim(btrim(rr.raw ->> 'jkNo'), '0'), ''))::int AS ids,
               COUNT(*)::int AS rides,
               MAX(rr.race_date) AS last_date
          FROM race_results rr
         WHERE rr.race_date >= :since
           AND NULLIF(btrim(rr.jockey_name), '') IS NOT NULL
         GROUP BY 1, 2
        HAVING COUNT(DISTINCT NULLIF(ltrim(btrim(rr.raw ->> 'jkNo'), '0'), '')) >= 2
         ORDER BY rides DESC, name
         LIMIT 30
    """,
    # ⑤ raw 값 분포 (Python parse.py 로 판정)
    "q05_values": """
        SELECT x.key, x.v, COUNT(*)::int AS n
          FROM race_results rr
         CROSS JOIN LATERAL (VALUES ('rcTime', rr.raw ->> 'rcTime'),
                                    ('rcDist', rr.raw ->> 'rcDist'),
                                    ('wgBudam', rr.raw ->> 'wgBudam'),
                                    ('hrRating', rr.raw ->> 'hrRating')) AS x(key, v)
         WHERE rr.race_date >= :since
         GROUP BY 1, 2
        UNION ALL
        SELECT y.key, y.v, COUNT(*)::int AS n
          FROM race_entries e
         CROSS JOIN LATERAL (VALUES ('entry_wgBudam', e.raw ->> 'wgBudam'),
                                    ('entry_hrRating', e.raw ->> 'hrRating')) AS y(key, v)
         WHERE e.race_date >= :since
         GROUP BY 1, 2
    """,
    "q05_time_column": """
        SELECT COUNT(*)::int AS n,
               COUNT(*) FILTER (
                   WHERE rr.record_time IS NULL
                     AND NULLIF(btrim(rr.raw ->> 'rcTime'), '') IS NOT NULL
                     AND btrim(rr.raw ->> 'rcTime') <> '-')::int AS null_with_raw
          FROM race_results rr
         WHERE rr.race_date >= :since
    """,
    # ⑥ 경마장별 결과 보유 기간
    "q06_retention": """
        SELECT rr.meet,
               MIN(rr.race_date) AS first_date,
               MAX(rr.race_date) AS last_date,
               COUNT(DISTINCT rr.race_date)::int AS days,
               COUNT(*)::int AS n
          FROM race_results rr
         GROUP BY rr.meet
         ORDER BY rr.meet
    """,
    "q06_years": """
        SELECT rr.meet,
               EXTRACT(YEAR FROM rr.race_date)::int AS year,
               COUNT(DISTINCT rr.race_date)::int AS days
          FROM race_results rr
         WHERE rr.race_date >= :since
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    # ⑦ 연속일 출주 · 같은 날 두 번
    "q07_consecutive": f"""
        SELECT COUNT(*)::int AS pairs,
               COUNT(DISTINCT a.horse_no)::int AS horses,
               MAX(b.race_date) AS last_date
          FROM race_results a
          JOIN race_results b
            ON b.horse_no = a.horse_no
           AND b.race_date = a.race_date + 1
         WHERE a.race_date >= :since
           AND {_STARTED.replace("rr.", "a.")}
           AND {_STARTED.replace("rr.", "b.")}
    """,
    "q07_same_day": """
        SELECT COUNT(*)::int AS n
          FROM (SELECT rr.horse_no, rr.race_date
                  FROM race_results rr
                 WHERE rr.race_date >= :since
                 GROUP BY 1, 2
                HAVING COUNT(*) >= 2) t
    """,
    # ⑧ 경마장별 발주 시각 (첫 발주는 Python queries.first_post_of)
    "q08_start_times": """
        SELECT r.race_date,
               r.meet,
               array_remove(array_agg(NULLIF(btrim(r.start_time), '')), NULL) AS start_times,
               COUNT(*)::int AS races
          FROM races r
         WHERE r.race_date >= :since
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    # ⑨ 출전표 첫 도착 · (D, 경마장) 배치당 updated_at 단일성
    "q09_entries": """
        SELECT t.race_date,
               t.meet,
               MIN(t.fetched_at) AS first_fetched,
               MAX(t.updated_at) AS batch_at,
               COUNT(DISTINCT t.updated_at)::int AS stamps,
               COUNT(*)::int AS n,
               COUNT(*) FILTER (
                   WHERE t.updated_at < t.batch - (:tol * interval '1 minute'))::int AS stale
          FROM (SELECT e.race_date, e.meet, e.fetched_at, e.updated_at,
                       MAX(e.updated_at) OVER (PARTITION BY e.race_date, e.meet) AS batch
                  FROM race_entries e
                 WHERE e.race_date >= :lo) t
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    # ⑩ jockey_changes 수집 시각
    "q10_first": """
        SELECT MIN(jc.fetched_at) AS first_fetched,
               MIN(jc.race_date) AS first_race_date,
               COUNT(*)::int AS n
          FROM jockey_changes jc
    """,
    "q10_recent": """
        SELECT jc.race_date, jc.meet, jc.fetched_at
          FROM jockey_changes jc
         WHERE jc.race_date >= :lo
         ORDER BY 1, 2
    """,
    # ⑪ 단승 배당 커버리지 · 배당 출전번호 ↔ 결과 chulNo
    "q11_coverage": """
        WITH k AS (
            SELECT DISTINCT rr.race_date, rr.meet, rr.race_no
              FROM race_results rr
             WHERE rr.race_date >= :since
        ),
        w AS (
            SELECT DISTINCT d.race_date, d.meet, d.race_no
              FROM race_dividends d
             WHERE d.race_date >= :since
               AND d.win_rate > 0
        )
        SELECT k.meet,
               EXTRACT(YEAR FROM k.race_date)::int AS year,
               COUNT(*)::int AS races,
               COUNT(w.race_no)::int AS with_win
          FROM k
          LEFT JOIN w USING (race_date, meet, race_no)
         GROUP BY 1, 2
         ORDER BY 1, 2
    """,
    "q11_unmatched": """
        WITH d AS (
            SELECT d.race_date, d.meet, d.race_no,
                   NULLIF(ltrim(btrim(d.horse_no), '0'), '') AS chul
              FROM race_dividends d
             WHERE d.race_date >= :since
               AND d.win_rate > 0
        ),
        r AS (
            SELECT DISTINCT rr.race_date, rr.meet, rr.race_no,
                   NULLIF(ltrim(btrim(rr.raw ->> 'chulNo'), '0'), '') AS chul
              FROM race_results rr
             WHERE rr.race_date >= :since
        )
        SELECT COUNT(*)::int AS n,
               COUNT(*) FILTER (WHERE r.race_no IS NULL)::int AS unmatched
          FROM d
          LEFT JOIN r
            ON r.race_date = d.race_date AND r.meet = d.meet
           AND r.race_no = d.race_no AND r.chul = d.chul
    """,
    # ⑫ meet 값
    "q12_meets": """
        SELECT 'races' AS tbl, meet, COUNT(*)::int AS n FROM races GROUP BY meet
        UNION ALL
        SELECT 'race_entries', meet, COUNT(*)::int FROM race_entries GROUP BY meet
        UNION ALL
        SELECT 'race_results', meet, COUNT(*)::int FROM race_results GROUP BY meet
        UNION ALL
        SELECT 'race_dividends', meet, COUNT(*)::int FROM race_dividends GROUP BY meet
        UNION ALL
        SELECT 'jockey_changes', meet, COUNT(*)::int FROM jockey_changes GROUP BY meet
        UNION ALL
        SELECT 'horse_rank_changes', meet, COUNT(*)::int FROM horse_rank_changes GROUP BY meet
        UNION ALL
        SELECT 'race_plans', meet, COUNT(*)::int FROM race_plans GROUP BY meet
    """,
    # ⑬ 연속 출주 사이 레이팅 차이 분포
    "q13_rating_deltas": rf"""
        WITH s AS (
            SELECT rr.horse_no, rr.race_date, rr.race_no,
                   CASE WHEN btrim(rr.raw ->> 'hrRating') ~ {_POS_INT}
                        THEN round(btrim(rr.raw ->> 'hrRating')::numeric)::int END AS r
              FROM race_results rr
             WHERE rr.race_date >= :since
               AND {_STARTED}
        ),
        d AS (
            SELECT s.r,
                   LAG(s.r) OVER (PARTITION BY s.horse_no ORDER BY s.race_date, s.race_no)
                       AS prev
              FROM s
        )
        SELECT d.r - d.prev AS delta, COUNT(*)::int AS n
          FROM d
         WHERE d.r IS NOT NULL AND d.prev IS NOT NULL
         GROUP BY 1
         ORDER BY 1
    """,
    # ⑭ 동착
    "q14_dead_heats": """
        SELECT t.rank, COUNT(*)::int AS races, MAX(t.race_date) AS last_date
          FROM (SELECT rr.race_date, rr.meet, rr.race_no, rr.rank
                  FROM race_results rr
                 WHERE rr.race_date >= :since
                   AND rr.rank BETWEEN 1 AND 3
                 GROUP BY 1, 2, 3, 4
                HAVING COUNT(*) >= 2) t
         GROUP BY t.rank
         ORDER BY t.rank
    """,
    "q14_examples": """
        SELECT rr.race_date, rr.meet, rr.race_no, rr.rank, COUNT(*)::int AS horses
          FROM race_results rr
         WHERE rr.race_date >= :since
           AND rr.rank BETWEEN 1 AND 3
         GROUP BY 1, 2, 3, 4
        HAVING COUNT(*) >= 2
         ORDER BY 1 DESC, 2, 3, 4
         LIMIT 5
    """,
    # ⑮ 경주별 레이팅 보유 (출전표 최근 8주 · 결과표 출주)
    "q15_entries": rf"""
        SELECT e.race_date, e.meet, e.race_no,
               COUNT(*)::int AS n,
               COUNT(*) FILTER (
                   WHERE COALESCE(e.rating, 0) > 0
                      OR btrim(e.raw ->> 'hrRating') ~ {_POS_INT})::int AS rated
          FROM race_entries e
         WHERE e.race_date >= :lo
         GROUP BY 1, 2, 3
    """,
    "q15_results": rf"""
        SELECT rr.meet,
               EXTRACT(YEAR FROM rr.race_date)::int AS year,
               rr.race_date,
               rr.race_no,
               COUNT(*)::int AS n,
               COUNT(*) FILTER (WHERE btrim(rr.raw ->> 'hrRating') ~ {_POS_INT})::int AS rated
          FROM race_results rr
         WHERE rr.race_date >= :since
           AND {_STARTED}
         GROUP BY 1, 2, 3, 4
    """,
    # ⑯ Q2·Q3 실행 계획 (EXPLAIN — 실행하지 않는다)
    "q16_sample": """
        SELECT e.race_date, e.meet, e.horse_no, NULLIF(btrim(e.jockey_name), '') AS jockey_name
          FROM race_entries e
         WHERE e.race_date = (SELECT MAX(x.race_date) FROM race_entries x
                               WHERE x.race_date <= :horizon)
         ORDER BY e.meet, e.race_no, e.horse_no
         LIMIT 300
    """,
    "q16_size": """
        SELECT COALESCE((SELECT c.reltuples::bigint FROM pg_class c
                          WHERE c.oid = to_regclass('race_results')), 0) AS race_results_rows
    """,
    "q16_explain_q2": "EXPLAIN (FORMAT JSON) " + queries._Q2_HISTORY.text,
    "q16_explain_q3": "EXPLAIN (FORMAT JSON) " + queries._Q3_JOCKEY.text,
    # ⑰ jockey_changes 조인 키 (race_date, race_no, horse_no) 중복
    "q17_jc_dups": """
        SELECT COUNT(*)::int AS keys,
               COUNT(*) FILTER (WHERE t.n > 1)::int AS dup_keys,
               COUNT(*) FILTER (WHERE t.after_names > 1)::int AS conflicting,
               COALESCE(MAX(t.n), 0)::int AS max_rows
          FROM (SELECT jc.race_date, jc.race_no, jc.horse_no,
                       COUNT(*) AS n,
                       COUNT(DISTINCT NULLIF(btrim(jc.jk_name_after), '')) AS after_names
                  FROM jockey_changes jc
                 GROUP BY 1, 2, 3) t
    """,
    # ⑱ PG 버전 (sha256() 는 PG 11+)
    "q18_version": """
        SELECT current_setting('server_version_num')::int AS num, version() AS version
    """,
}


# ---------------------------------------------------------------------------
# provider
# ---------------------------------------------------------------------------


class Rows(Protocol):
    def rows(self, name: str, **params: Any) -> list[dict[str, Any]]: ...


class SqlRows:
    """`QUERIES[name]` 을 읽기 전용 트랜잭션 하나로 실행하고 rollback.

    쿼리마다 트랜잭션을 따로 쓴다 — 한 항목의 실패(시간 초과 등)가 다음 항목의 트랜잭션을
    abort 상태로 오염시키지 않도록 (healthcheck.SqlRowProvider 와 같은 방식, 쿼리 dict 만 다르다).
    """

    def __init__(self, engine: Any) -> None:
        self._engine = engine

    def rows(self, name: str, **params: Any) -> list[dict[str, Any]]:
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


def _one(db: Rows, name: str, **params: Any) -> dict[str, Any]:
    rows = db.rows(name, **params)
    return rows[0] if rows else {}


# ---------------------------------------------------------------------------
# 결과 타입
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Ctx:
    now: datetime  # tz-aware
    today: date  # KST
    since: date  # 오늘 − LOOKBACK_DAYS
    recent: date  # 오늘 − RECENT_DAYS
    defn: RuleSetDef


@dataclass(frozen=True)
class Item:
    no: int
    key: str
    title: str
    status: str
    summary: str
    lines: tuple[str, ...] = ()
    data: Any = None

    def to_json(self) -> dict[str, Any]:
        return {
            "no": self.no,
            "key": self.key,
            "title": self.title,
            "status": self.status,
            "summary": self.summary,
            "lines": list(self.lines),
            "data": self.data,
        }


@dataclass
class _Out:
    """항목 함수의 결과 (상태·요약·세부 줄·데이터)."""

    status: str
    summary: str
    lines: list[str] = field(default_factory=list)
    data: Any = None


# ---------------------------------------------------------------------------
# 보조
# ---------------------------------------------------------------------------


def _pct(num: int, den: int) -> str:
    return f"{parse.pct(num, den)}%" if den > 0 else "-"


def _ratio(num: int, den: int) -> str:
    return f"{num:,}/{den:,} ({_pct(num, den)})"


def _err(exc: BaseException) -> str:
    return " ".join(redact(f"{type(exc).__name__}: {exc}").split())[:200]


def _kst(dt: datetime) -> datetime:
    return dt.astimezone(KST) if dt.tzinfo is not None else dt.replace(tzinfo=KST)


def _ymd(d: date) -> str:
    return f"{d.isoformat()}({_WEEKDAY_KO[d.weekday()]})"


def _hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _rel_day(d: date, dt: datetime) -> str:
    """경주일 d 기준 상대 시각 — 'D−2 16:05' · 'D 당일 07:30'."""
    k = _kst(dt)
    days = (d - k.date()).days
    tag = "D 당일" if days == 0 else (f"D−{days}" if days > 0 else f"D+{-days}")
    return f"{tag} {k:%H:%M}"


def _is_missing(v: Any) -> bool:
    return v is None or str(v).strip() in ("", "-")


def _is_zero(v: Any) -> bool:
    try:
        return Decimal(str(v).strip()) == 0
    except (InvalidOperation, ValueError):
        return False


_DIGITS = re.compile(r"^\s*\d+\s*[mM]?\s*$")


# ---------------------------------------------------------------------------
# 항목 ①~⑱
# ---------------------------------------------------------------------------


def item_01(db: Rows, ctx: Ctx) -> _Out:
    classes = db.rows("q01_classes", since=ctx.since)
    samples = db.rows("q01_samples", since=ctx.since)

    def total(cls: str) -> int:
        return sum(int(r["n"]) for r in classes if r["cls"] == cls)

    ranked, timed, none = total("ranked"), total("unranked_timed"), total("no_rank_no_time")
    rank0 = sum(int(r["n"]) for r in classes if r["cls"] != "ranked" and not r["rank_null"])
    out = _Out(
        INFO,
        f"착순 있음 {ranked:,} · 착순 없음+기록 있음 {timed:,} (출주로 셈, 입상 아님) · "
        f"착순·기록 없음 {none:,} (미출주) · 그중 rank 0 {rank0:,}",
    )
    if samples:
        out.lines.append(
            "착순 없는 행의 raw 표식 (ord · stOrd · rcTime · differ · 기록 컬럼 → 건수):"
        )
        for s in samples[:10]:
            out.lines.append(
                f"  {s['ord']!r} · {s['st_ord']!r} · {s['rc_time']!r} · {s['differ']!r} · "
                f"{'기록 있음' if s['has_time'] else '기록 없음'} → {int(s['n']):,} "
                f"(최근 {s['last_date']})"
            )
    out.lines.append("→ '출전취소' 표식이 따로 구분되면 그 표식만 무효로 완화할지 사전 등록 (5.4)")
    out.data = {
        "ranked": ranked,
        "unranked_timed": timed,
        "no_rank_no_time": none,
        "rank_zero": rank0,
        "samples": samples,
    }
    return out


def item_02(db: Rows, ctx: Ctx) -> _Out:
    tol = int(ctx.defn.p("stale", "batch_tolerance_min"))
    rows = db.rows("q02_stale", lo=ctx.recent, today=ctx.today, tol=tol)
    cell = {(bool(r["stale"]), bool(r["started"])): int(r["n"]) for r in rows}
    tp = cell.get((True, False), 0)  # stale 이고 실제로 안 뜀
    fp = cell.get((True, True), 0)  # stale 인데 뛰었음
    fn = cell.get((False, False), 0)  # stale 아닌데 안 뜀 (놓침)
    tn = cell.get((False, True), 0)
    total = tp + fp + fn + tn
    out = _Out(
        INFO,
        f"최근 8주 결과가 있는 출전표 {total:,}행 — 판정 일치 {_ratio(tp + tn, total)} · "
        f"stale {tp + fp}행 중 실제 미출주 {_ratio(tp, tp + fp)} · 안 뛴 말 중 stale 로 잡힌 "
        f"{_ratio(tp, tp + fn)}",
    )
    out.lines.append(
        "→ SHOW_SCRATCH_HINT(발행 후 '출전표에서 빠짐')는 stale 정밀도가 충분히 높을 때만 "
        "켠다 (기본 끔)"
    )
    out.data = {"stale_not_started": tp, "stale_started": fp, "fresh_not_started": fn,
                "fresh_started": tn, "tolerance_min": tol}
    return out


def item_03(db: Rows, ctx: Ctx) -> _Out:
    rows = db.rows("q03_rating_pairs", since=ctx.since)
    per: dict[str, dict[str, int]] = defaultdict(
        lambda: {"pairs": 0, "both": 0, "equal": 0, "entry_only": 0, "result_only": 0}
    )
    for r in rows:
        n = int(r["n"])
        e = parse.parse_rating(r["entry_rating"])
        if e is None:
            e = parse.parse_rating(r["entry_raw"])
        x = parse.parse_rating(r["result_raw"])
        for key in (str(r["meet"]), "전체"):
            c = per[key]
            c["pairs"] += n
            if e is not None and x is not None:
                c["both"] += n
                c["equal"] += n if e == x else 0
            elif e is not None:
                c["entry_only"] += n
            elif x is not None:
                c["result_only"] += n
    tot = per["전체"]
    status = INFO
    if tot["both"] and tot["equal"] * 100 < RATING_MATCH_MIN_PCT * tot["both"]:
        status = WARN
    elif tot["both"]:
        status = OK
    out = _Out(
        status,
        f"출전표·결과가 모두 있는 {tot['pairs']:,}쌍 중 둘 다 레이팅 {tot['both']:,} — 일치 "
        f"{_ratio(tot['equal'], tot['both'])} (게이트 ⑤ 기준 {RATING_MATCH_MIN_PCT}%)",
    )
    for meet in sorted(k for k in per if k != "전체"):
        c = per[meet]
        out.lines.append(
            f"  {meet}: 일치 {_ratio(c['equal'], c['both'])} · 출전표에만 {c['entry_only']:,} · "
            f"결과에만 {c['result_only']:,}"
        )
    if status == WARN:
        out.lines.append("→ 미달이면 rating 의 과거 시험 수치는 게이트에서 빼고 G1 에서 판단 (5.5)")
    out.data = {k: dict(v) for k, v in per.items()}
    return out


def item_04(db: Rows, ctx: Ctx) -> _Out:
    years = db.rows("q04_jk_years", since=ctx.since)
    homs = db.rows("q04_homonyms", since=ctx.since)
    total = sum(int(r["n"]) for r in years)
    with_no = sum(int(r["with_jk_no"]) for r in years)
    out = _Out(
        INFO,
        f"최근 3년 결과 jkNo 보유 {_ratio(with_no, total)} · 동명이인(번호 2개 이상) {len(homs)}명"
        + (" 이상" if len(homs) >= 30 else ""),
    )
    for r in years:
        out.lines.append(
            f"  {r['year']} {r['meet']}: jkNo {_ratio(int(r['with_jk_no']), int(r['n']))}"
        )
    for h in homs[:10]:
        out.lines.append(
            f"  동명이인 {h['meet']} {h['name']} — 번호 {h['ids']}개 · 기승 {int(h['rides']):,} "
            f"(최근 {h['last_date']})"
        )
    out.data = {"years": years, "homonyms": homs}
    return out


def _value_parsers(defn: RuleSetDef) -> dict[str, Callable[[Any], int | None]]:
    return {
        "rcTime": parse.parse_time_tenths,
        "rcDist": lambda v: parse.parse_distance(v, defn),
        "wgBudam": parse.parse_tenths,
        "hrRating": parse.parse_rating,
        "entry_wgBudam": parse.parse_tenths,
        "entry_hrRating": parse.parse_rating,
    }


def item_05(db: Rows, ctx: Ctx) -> _Out:
    vals = db.rows("q05_values", since=ctx.since)
    col = _one(db, "q05_time_column", since=ctx.since)
    parsers = _value_parsers(ctx.defn)
    stats: dict[str, dict[str, Any]] = {
        k: {"rows": 0, "missing": 0, "ok": 0, "zero": 0, "out_of_range": 0, "failed": 0,
            "failed_examples": []}
        for k in parsers
    }
    for r in vals:
        key, v, n = r["key"], r["v"], int(r["n"])
        st = stats[key]
        st["rows"] += n
        if _is_missing(v):
            st["missing"] += n
        elif parsers[key](v) is not None:
            st["ok"] += n
        elif _is_zero(v):
            st["zero"] += n
        elif key == "rcDist" and _DIGITS.match(str(v)):
            st["out_of_range"] += n
        else:
            st["failed"] += n
            if len(st["failed_examples"]) < 3:
                st["failed_examples"].append(str(v))
    warn = False
    out = _Out(INFO, "")
    parts = []
    for key, st in stats.items():
        present = st["rows"] - st["missing"]
        if present and st["failed"] * 100 > PARSE_FAIL_WARN_PCT * present:
            warn = True
        parts.append(f"{key} 실패 {_pct(st['failed'], present)}")
        out.lines.append(
            f"  {key}: 값 있음 {present:,} · 파싱 {st['ok']:,} · 0 {st['zero']:,} · "
            f"범위 밖 {st['out_of_range']:,} · 실패 {st['failed']:,}"
            + (f" (예: {st['failed_examples']})" if st["failed_examples"] else "")
        )
    null_with_raw = int(col.get("null_with_raw") or 0)
    out.lines.append(f"  record_time 이 NULL 인데 raw rcTime 이 있는 행 {null_with_raw:,}")
    out.status = WARN if warn or null_with_raw else OK
    out.summary = " · ".join(parts)
    out.data = {"values": stats, "record_time_null_with_raw": null_with_raw}
    return out


def item_06(db: Rows, ctx: Ctx) -> _Out:
    rows = db.rows("q06_retention")
    years = db.rows("q06_years", since=ctx.since)
    window = int(ctx.defn.p("rules", "form", "window_days"))
    need_from = DEV_PERIOD[0] - timedelta(days=window)
    warn = False
    out = _Out(INFO, "")
    parts = []
    for r in rows:
        meet = parse.normalize_meet(r["meet"])
        label = str(r["meet"])
        parts.append(f"{label} {r['first_date']}~{r['last_date']} ({int(r['days']):,}일)")
        if meet is None:
            continue
        first = r["first_date"]
        if first is not None and first > need_from:
            warn = True
            usable = first + timedelta(days=window)
            if usable > DEV_PERIOD[1]:
                out.lines.append(
                    f"  {label}: 결과가 {first} 부터 — dev({DEV_PERIOD[0]}~{DEV_PERIOD[1]}) 기간에 "
                    f"워밍업 {window}일을 채울 수 없다 (이 DB 로는 dev 과거 시험 불가)"
                )
            else:
                out.lines.append(
                    f"  {label}: 결과가 {first} 부터 — dev 워밍업 {window}일이 모자람 → 결과를 "
                    f"보기 전에 dev 시작을 {usable} 이후로 줄인다"
                )
        last = r["last_date"]
        if last is not None and last < HOLDOUT_PERIOD[1]:
            out.lines.append(
                f"  {label}: 결과가 {last} 까지 — holdout({HOLDOUT_PERIOD[1]}까지)보다 짧음"
            )
    for y in years:
        out.lines.append(f"  {y['meet']} {y['year']}년 경주일 {y['days']}일")
    out.status = WARN if warn else OK
    out.summary = " · ".join(parts) if parts else "결과 없음"
    if not rows:
        out.status = WARN
    out.data = {"retention": rows, "days_by_year": years, "dev_needs_from": need_from}
    return out


def item_07(db: Rows, ctx: Ctx) -> _Out:
    c = _one(db, "q07_consecutive", since=ctx.since)
    s = _one(db, "q07_same_day", since=ctx.since)
    pairs = int(c.get("pairs") or 0)
    out = _Out(
        INFO,
        f"전날·다음날 연속 출주 {pairs:,}건 (말 {int(c.get('horses') or 0):,}두, 최근 "
        f"{c.get('last_date') or '-'}) · 같은 날 결과 2행 이상 {int(s.get('n') or 0):,}건",
    )
    if pairs:
        out.lines.append("→ D−1 결과는 H 컷으로 빠진다 — 그 말의 직전 성적은 다음 호부터 반영")
    out.data = {"consecutive": c, "same_day": s}
    return out


def item_08(db: Rows, ctx: Ctx) -> _Out:
    rows = db.rows("q08_start_times", since=ctx.since)
    per: dict[str, dict[str, Any]] = {}
    for r in rows:
        meet = str(r["meet"])
        st = per.setdefault(
            meet, {"days": 0, "no_time": 0, "earliest": None, "latest": None, "before_9": 0}
        )
        st["days"] += 1
        fp = queries.first_post_of(r["start_times"] or [])
        minutes = schedule.parse_hhmm(fp)
        if minutes is None:
            st["no_time"] += 1
            continue
        st["earliest"] = minutes if st["earliest"] is None else min(st["earliest"], minutes)
        st["latest"] = minutes if st["latest"] is None else max(st["latest"], minutes)
        if minutes < 9 * 60:
            st["before_9"] += 1
    out = _Out(INFO, "")
    parts = []
    for meet in sorted(per):
        st = per[meet]
        e = _hhmm(st["earliest"]) if st["earliest"] is not None else "-"
        parts.append(f"{meet} {e}")
        out.lines.append(
            f"  {meet}: 경주일 {st['days']} · 첫 발주 가장 이름 {e} · 가장 늦음 "
            f"{_hhmm(st['latest']) if st['latest'] is not None else '-'} · 발주 시각 없음 "
            f"{st['no_time']}일 · 09:00 전 첫 발주(마감이 08:00 보다 이름) {st['before_9']}일"
        )
    out.summary = "가장 이른 첫 발주: " + (" · ".join(parts) if parts else "자료 없음")
    out.data = per
    return out


def item_09(db: Rows, ctx: Ctx) -> _Out:
    tol = int(ctx.defn.p("stale", "batch_tolerance_min"))
    rows = db.rows("q09_entries", lo=ctx.recent, tol=tol)
    groups: dict[tuple[int, str], dict[str, Any]] = {}
    multi = stale_rows = late_total = 0
    for r in rows:
        d: date = r["race_date"]
        meet = str(r["meet"])
        first: datetime = r["first_fetched"]
        late = first >= schedule.freeze_at(d, ctx.defn)
        g = groups.setdefault(
            (d.weekday(), meet), {"days": 0, "late": 0, "latest": None, "latest_text": "-"}
        )
        g["days"] += 1
        offset = _kst(first) - datetime.combine(d, time(0), tzinfo=KST)
        if g["latest"] is None or offset > g["latest"]:
            g["latest"] = offset
            g["latest_text"] = _rel_day(d, first)
        if late:
            g["late"] += 1
            late_total += 1
        if int(r["stamps"]) > 1:
            multi += 1
        stale_rows += int(r["stale"])
    out = _Out(
        WARN if late_total else (OK if rows else INFO),
        f"최근 8주 (경주일, 경마장) {len(rows)}개 — 동결(D−1 18:00) 뒤 첫 도착 {late_total}개 · "
        f"updated_at 이 여러 값인 배치 {multi}개 · stale 행 {stale_rows}",
    )
    for (wd, meet), g in sorted(groups.items()):
        out.lines.append(
            f"  {_WEEKDAY_KO[wd]}요일 {meet}: {g['days']}일 · 가장 늦은 첫 도착 {g['latest_text']}"
            f" · 동결 뒤 {g['late']}"
        )
    out.data = {
        "groups": {f"{_WEEKDAY_KO[wd]}|{m}": {k: v for k, v in g.items() if k != "latest"}
                   for (wd, m), g in sorted(groups.items())},
        "late": late_total,
        "multi_stamp_batches": multi,
        "stale_rows": stale_rows,
    }
    return out


def item_10(db: Rows, ctx: Ctx) -> _Out:
    first = _one(db, "q10_first")
    rows = db.rows("q10_recent", lo=ctx.recent)
    before = after = on_day = 0
    for r in rows:
        d: date = r["race_date"]
        fetched: datetime = r["fetched_at"]
        if fetched < schedule.freeze_at(d, ctx.defn):
            before += 1
        else:
            after += 1
            if _kst(fetched).date() >= d:
                on_day += 1
    ff = first.get("first_fetched")
    out = _Out(
        INFO,
        f"첫 수집 {(_kst(ff).strftime('%Y-%m-%d %H:%M') + ' KST') if ff else '-'} (경주일 "
        f"{first.get('first_race_date') or '-'}부터 {int(first.get('n') or 0):,}건) · 최근 8주 "
        f"{len(rows)}건 — 발행 전 수집 {before} · 발행 뒤 {after} (당일 {on_day})",
    )
    out.lines.append("→ 발행 뒤 들어온 교체는 1면·경주면의 '발행 후 기수 변경' 상자로만 덧씌운다")
    out.data = {"first": first, "before_freeze": before, "after_freeze": after, "on_day": on_day}
    return out


def item_11(db: Rows, ctx: Ctx) -> _Out:
    cov = db.rows("q11_coverage", since=ctx.since)
    um = _one(db, "q11_unmatched", since=ctx.since)
    races = sum(int(r["races"]) for r in cov)
    with_win = sum(int(r["with_win"]) for r in cov)
    n, unmatched = int(um.get("n") or 0), int(um.get("unmatched") or 0)
    status = WARN if n and unmatched * 100 > n else INFO
    out = _Out(
        status,
        f"최근 3년 결과 경주 중 단승 배당 있음 {_ratio(with_win, races)} · 배당 출전번호가 결과 "
        f"chulNo 와 안 맞는 행 {_ratio(unmatched, n)}",
    )
    for r in cov:
        out.lines.append(
            f"  {r['year']} {r['meet']}: {_ratio(int(r['with_win']), int(r['races']))}"
        )
    out.data = {"coverage": cov, "unmatched": um}
    return out


def item_12(db: Rows, ctx: Ctx) -> _Out:
    rows = db.rows("q12_meets")
    odd = [r for r in rows if parse.normalize_meet(r["meet"]) is None]
    alias = [r for r in rows if r["meet"] == "부산경남"]
    out = _Out(
        WARN if odd else OK,
        "서울·부경·제주 외 값 "
        + (
            ", ".join(f"{r['tbl']} {r['meet']!r} {int(r['n']):,}" for r in odd)
            if odd
            else "없음"
        )
        + (
            f" · '부산경남' 별칭 {sum(int(r['n']) for r in alias):,}행 "
            f"({', '.join(sorted({r['tbl'] for r in alias}))}) — 부경으로 읽는다"
            if alias
            else ""
        ),
    )
    if odd:
        out.lines.append("→ 이 값의 행은 경마지에서 제외된다 (meet 정규화 — 계약 §1)")
    out.data = rows
    return out


def item_13(db: Rows, ctx: Ctx) -> _Out:
    rows = db.rows("q13_rating_deltas", since=ctx.since)
    thr = int(ctx.defn.p("news", "rating_change_min"))
    buckets = {"0": 0, "1": 0, "2": 0, "3-4": 0, "5-9": 0, "10+": 0}
    total = over = 0
    for r in rows:
        dlt, n = abs(int(r["delta"])), int(r["n"])
        total += n
        if dlt >= thr:
            over += n
        key = (
            "0" if dlt == 0 else "1" if dlt == 1 else "2" if dlt == 2
            else "3-4" if dlt <= 4 else "5-9" if dlt <= 9 else "10+"
        )
        buckets[key] += n
    out = _Out(
        INFO,
        f"연속 출주 사이 레이팅 차이 {total:,}쌍 — |Δ| ≥ {thr} {_ratio(over, total)} "
        f"(배지 rating_change 기준)",
    )
    out.lines.append(
        "  " + " · ".join(f"|Δ| {k}: {_pct(v, total)}" for k, v in buckets.items())
    )
    out.data = {"buckets": buckets, "total": total, "at_or_over_threshold": over}
    return out


def item_14(db: Rows, ctx: Ctx) -> _Out:
    rows = db.rows("q14_dead_heats", since=ctx.since)
    ex = db.rows("q14_examples", since=ctx.since)
    by_rank = {int(r["rank"]): int(r["races"]) for r in rows}
    out = _Out(
        INFO,
        "최근 3년 동착 경주 — "
        + " · ".join(f"{k}착 {by_rank.get(k, 0)}" for k in (1, 2, 3)),
    )
    for e in ex:
        out.lines.append(
            f"  {e['race_date']} {e['meet']} {e['race_no']}R {e['rank']}착 {e['horses']}두"
        )
    out.lines.append("→ 동착은 winners·placed 배열로 모두 적중 처리 (계약 §6)")
    out.data = {"by_rank": by_rank, "examples": ex}
    return out


def _rating_participation(rows: Iterable[Mapping[str, Any]], defn: RuleSetDef) -> tuple[int, int]:
    """경주별 (n, rated) → rating 기준이 예상을 낼 수 있는 경주 수 / 경주 수."""
    min_active = int(defn.p("field", "min_active"))
    floor = int(defn.p("rules", "rating", "min_eligible_floor"))
    ok = total = 0
    for r in rows:
        n, rated = int(r["n"]), int(r["rated"])
        total += 1
        if n >= min_active and rated >= max(floor, parse.ceil_half(n)):
            ok += 1
    return ok, total


def item_15(db: Rows, ctx: Ctx) -> _Out:
    entries = db.rows("q15_entries", lo=ctx.recent)
    results = db.rows("q15_results", since=ctx.since)
    warn = False
    out = _Out(INFO, "")
    parts = []
    by_meet_e: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for r in entries:
        by_meet_e[str(r["meet"])].append(r)
    for meet in sorted(by_meet_e):
        rs = by_meet_e[meet]
        ok, total = _rating_participation(rs, ctx.defn)
        rows_n = sum(int(r["n"]) for r in rs)
        rated = sum(int(r["rated"]) for r in rs)
        parts.append(f"{meet} {_pct(ok, total)}")
        out.lines.append(
            f"  출전표 최근 8주 {meet}: 레이팅 결측 {_ratio(rows_n - rated, rows_n)} · rating 기준 "
            f"참여 가능 경주 {_ratio(ok, total)}"
        )
        if total and ok * 100 < PARTICIPATION_MIN_PCT * total:
            warn = True
    by_meet_year: dict[tuple[str, int], list[Mapping[str, Any]]] = defaultdict(list)
    for r in results:
        by_meet_year[(str(r["meet"]), int(r["year"]))].append(r)
    latest_year = max((y for _, y in by_meet_year), default=None)
    for (meet, year), rs in sorted(by_meet_year.items()):
        ok, total = _rating_participation(rs, ctx.defn)
        out.lines.append(f"  결과표 {year} {meet}: rating 기준 참여 가능 경주 {_ratio(ok, total)}")
        if year == latest_year and total and ok * 100 < PARTICIPATION_MIN_PCT * total:
            warn = True
    out.status = WARN if warn else (OK if entries or results else INFO)
    out.summary = (
        "rating 기준 참여 가능 경주 (출전표 최근 8주): " + (" · ".join(parts) if parts else "-")
        + f" — 게이트 ③ {PARTICIPATION_MIN_PCT}%"
    )
    if warn:
        out.lines.append("→ 제주 포함 여부는 이 수치와 과거 시험 참여율로 G1 에서 정한다")
    out.data = {"entries": {m: _rating_participation(v, ctx.defn) for m, v in by_meet_e.items()},
                "results": {f"{m}|{y}": _rating_participation(v, ctx.defn)
                            for (m, y), v in sorted(by_meet_year.items())}}
    return out


def _plan_nodes(plan: Any) -> list[dict[str, Any]]:
    """EXPLAIN (FORMAT JSON) 결과 → 노드 목록 (깊이 우선)."""
    root = plan
    if isinstance(root, str):
        root = json.loads(root)
    if isinstance(root, list):
        root = root[0]
    out: list[dict[str, Any]] = []

    def walk(node: Mapping[str, Any]) -> None:
        out.append(dict(node))
        for child in node.get("Plans", []) or []:
            walk(child)

    walk(root["Plan"])
    return out


def _plan_summary(plan: Any) -> tuple[str, list[dict[str, Any]]]:
    nodes = _plan_nodes(plan)
    top = nodes[0]
    scans = [
        {
            "node": n.get("Node Type"),
            "relation": n.get("Relation Name"),
            "index": n.get("Index Name"),
        }
        for n in nodes
        if n.get("Relation Name") or n.get("Index Name")
    ]
    text_ = (
        f"비용 {top.get('Total Cost')} · 예상 행 {top.get('Plan Rows')} · "
        + ", ".join(
            f"{s['node']} {s['relation'] or ''}{(' (' + s['index'] + ')') if s['index'] else ''}"
            for s in scans
        )
    )
    return text_, scans


def item_16(db: Rows, ctx: Ctx) -> _Out:
    sample = db.rows("q16_sample", horizon=ctx.today + timedelta(days=7))
    size = int(_one(db, "q16_size").get("race_results_rows") or 0)
    if not sample:
        return _Out(INFO, "출전표 표본 없음 — EXPLAIN 생략", data={"race_results_rows": size})
    d: date = sample[0]["race_date"]
    meet = parse.normalize_meet(sample[0]["meet"]) or str(sample[0]["meet"])
    horses = sorted({str(r["horse_no"]) for r in sample if r["meet"] == sample[0]["meet"]})
    names = sorted({str(r["jockey_name"]) for r in sample
                    if r["meet"] == sample[0]["meet"] and r["jockey_name"]})
    h = schedule.history_before(d, ctx.defn)
    window = int(ctx.defn.p("rules", "jockey", "window_days"))
    p2 = db.rows("q16_explain_q2", horse_nos=horses, h=h)
    p3 = db.rows("q16_explain_q3", names=names or [""], meets=queries.meet_aliases(meet), h=h,
                 lo=h - timedelta(days=window))
    t2, s2 = _plan_summary(p2[0]["QUERY PLAN"])
    t3, s3 = _plan_summary(p3[0]["QUERY PLAN"])
    seq_q2 = any(s["node"] == "Seq Scan" and s["relation"] == "race_results" for s in s2)
    status = WARN if seq_q2 and size >= SEQ_SCAN_WARN_ROWS else OK
    out = _Out(
        status,
        f"표본 {d} {meet} 말 {len(horses)}두·기수 {len(names)}명 · race_results 약 {size:,}행 · "
        f"Q2 {'Seq Scan' if seq_q2 else '인덱스'}",
        [f"  Q2 이력: {t2}", f"  Q3 기수 집계: {t3}"],
    )
    if seq_q2 and size >= SEQ_SCAN_WARN_ROWS:
        out.lines.append("→ Q2 가 큰 race_results 를 Seq Scan — idx_race_results_horse_date 확인")
    out.lines.append("  (Q3 는 btrim(jockey_name) 비교라 Seq Scan 이 정상 — 호당 2회)")
    out.data = {
        "sample": {"race_date": d, "meet": meet, "horses": len(horses), "names": len(names)},
        "race_results_rows": size,
        "q2": s2,
        "q3": s3,
    }
    return out


def item_17(db: Rows, ctx: Ctx) -> _Out:
    r = _one(db, "q17_jc_dups")
    keys, dup = int(r.get("keys") or 0), int(r.get("dup_keys") or 0)
    conflicting = int(r.get("conflicting") or 0)
    out = _Out(
        WARN if conflicting else (OK if not dup else INFO),
        f"(경주일·경주번호·마번) 키 {keys:,} · 2행 이상 {dup:,} · 교체 기수가 서로 다른 키 "
        f"{conflicting:,} (최대 {int(r.get('max_rows') or 0)}행)",
    )
    out.lines.append(
        "→ Q1 은 LATERAL 최신 1건(updated_at DESC, id DESC)만 붙이므로 행이 늘지 않는다"
    )
    out.data = r
    return out


def item_18(db: Rows, ctx: Ctx) -> _Out:
    r = _one(db, "q18_version")
    num = int(r.get("num") or 0)
    if num < 110000:
        return _Out(FAIL, f"PostgreSQL {num} — sha256() 가 없다 (11 이상 필요)", data=r)
    return _Out(OK, f"PostgreSQL {num // 10000}.{num % 100} — sha256() 사용 가능", data=r)


@dataclass(frozen=True)
class Spec:
    no: int
    key: str
    title: str
    fn: Callable[[Rows, Ctx], _Out]


SPECS: tuple[Spec, ...] = (
    Spec(1, "start_classes", "rank NULL/0 × 기록 유무 · raw 표식", item_01),
    Spec(2, "stale_vs_scratch", "최근 8주 stale 판정 vs 실제 미출주", item_02),
    Spec(3, "rating_match", "출전표 rating ↔ 결과 hrRating 일치율", item_03),
    Spec(4, "jk_no", "연도별 jkNo 보유율 · 동명이인", item_04),
    Spec(5, "parse_failures", "rcTime·rcDist·wgBudam·hrRating 파싱 실패율", item_05),
    Spec(6, "retention", "경마장별 결과 보유 기간", item_06),
    Spec(7, "consecutive_days", "연속일 출주", item_07),
    Spec(8, "first_post", "경마장별 가장 이른 발주 시각", item_08),
    Spec(9, "entries_arrival", "요일·경마장별 출전표 첫 도착 · 배치 단일성", item_09),
    Spec(10, "jockey_changes_timing", "jockey_changes 수집 시각", item_10),
    Spec(11, "win_coverage", "단승 배당 커버리지", item_11),
    Spec(12, "meet_values", "서울·부경·제주 외 meet 값", item_12),
    Spec(13, "rating_deltas", "레이팅 증감 분포", item_13),
    Spec(14, "dead_heats", "동착", item_14),
    Spec(15, "rating_participation", "경마장별 레이팅 결측·참여율", item_15),
    Spec(16, "explain", "Q2·Q3 실행 계획 (EXPLAIN)", item_16),
    Spec(17, "jockey_change_dups", "jockey_changes 조인 중복", item_17),
    Spec(18, "pg_version", "PostgreSQL 버전", item_18),
)


# ---------------------------------------------------------------------------
# 실행·출력
# ---------------------------------------------------------------------------


def make_ctx(now: datetime, defn: RuleSetDef | None = None) -> Ctx:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    today = schedule.kst_today(now)
    return Ctx(
        now=now,
        today=today,
        since=today - timedelta(days=LOOKBACK_DAYS),
        recent=today - timedelta(days=RECENT_DAYS),
        defn=defn if defn is not None else definitions.active(),
    )


def run_preflight(db: Rows, now: datetime, defn: RuleSetDef | None = None) -> list[Item]:
    """18개 항목을 차례로 — 한 항목의 실패는 그 항목만 FAIL."""
    ctx = make_ctx(now, defn)
    items: list[Item] = []
    for spec in SPECS:
        try:
            o = spec.fn(db, ctx)
        except Exception as e:  # 한 항목 실패가 나머지를 막지 않도록
            items.append(Item(spec.no, spec.key, spec.title, FAIL, f"점검 실패 — {_err(e)}"))
            continue
        items.append(
            Item(spec.no, spec.key, spec.title, o.status, o.summary, tuple(o.lines), o.data)
        )
    return items


def exit_code(items: Iterable[Item]) -> int:
    return 1 if any(i.status == FAIL for i in items) else 0


def render_text(items: list[Item], now: datetime) -> str:
    k = _kst(now)
    lines = [
        f"mal-crawler 경마지 출시 전 감사 · {_ymd(k.date())} {k:%H:%M} KST · 읽기 전용 "
        f"(쿼리마다 READ ONLY, {STATEMENT_TIMEOUT_MS // 1000}초/{LOCK_TIMEOUT_MS // 1000}초)",
        "",
    ]
    for it in items:
        lines.append(f"{_CIRCLED[it.no - 1]} [{it.status}] {it.title} — {it.summary}")
        lines.extend(it.lines)
    counts = {s: sum(1 for i in items if i.status == s) for s in STATUSES}
    lines += [
        "",
        BACKUP_TOC_NOTE,
        "",
        "요약: " + " · ".join(f"{s} {counts[s]}" for s in STATUSES) + f" → exit {exit_code(items)}",
    ]
    return "\n".join(lines)


def render_json(items: list[Item], now: datetime) -> str:
    return json.dumps(
        {
            "generated_at": now.isoformat(),
            "exit_code": exit_code(items),
            "items": [i.to_json() for i in items],
            "notes": [BACKUP_TOC_NOTE],
        },
        ensure_ascii=False,
        indent=2,
        default=str,
    )


def run_cli(engine: Any, now: datetime, *, json_output: bool = False) -> tuple[str, int]:
    """CLI 진입 — (출력 문자열, 종료 코드). engine 은 호출 시점의 src.db.engine 을 넘긴다."""
    items = run_preflight(SqlRows(engine), now)
    out = render_json(items, now) if json_output else render_text(items, now)
    return out, exit_code(items)
