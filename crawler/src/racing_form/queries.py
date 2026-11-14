"""경마지 SQL provider — 계약 §1 (Q0~Q6 · 정산 입력) 을 `types.Provider` 로 구현.

- `SqlProvider(conn)`: conn 은 SQLAlchemy Connection 또는 Session (`.execute()` 만 쓴다).
  트랜잭션은 호출자가 연다. 잡·CLI 는 `read_only_provider()` 로 READ ONLY 트랜잭션
  (statement_timeout·lock_timeout 포함) 안에서 쓴다. 메서드는 쓰기를 하지 않는다.
- as-of: 이력 계열(Q2·Q3·results_through·unresolved_races)은 **race_date < :h** 를 SQL 에서
  강제한다 (features.assert_strictly_before 가 Python 에서 한 번 더 막는다).
- numeric 은 `::text` 로 꺼낸다 (Decimal·float 금지 — parse.py 가 0.1 단위 정수로 바꾼다).
  jsonb 숫자는 `raw->>'key'` 텍스트. 이름·라벨은 `NULLIF(btrim(…), '')`.
- 리스트 파라미터는 `= ANY(CAST(:list AS text[]))` (빈 리스트도 안전).
- 현재 시각을 읽지 않는다 (NOW()·CURRENT_DATE 금지). 날짜·기준일은 모두 인자.
- meet: races·race_entries·race_results·race_dividends 는 '서울'·'부경'·'제주' 로 저장된다
  (수집 클라이언트가 코드 → 라벨 변환). race_plans 는 prod 에서 '부산경남' 이라 별칭으로 찾고,
  Q3 집계는 Python 정규화(FakeProvider)와 같게 '부산경남' 도 같은 경마장으로 센다.

text() 주의: SQL 문자열 리터럴 안에 `:단어` 를 쓰지 않는다 (bind 파라미터로 해석된다).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager, contextmanager
from datetime import date, timedelta
from typing import Any

from sqlalchemy import text

from . import parse, schedule
from .types import (
    CalendarRow,
    ConnStat,
    DividendRow,
    EntryRow,
    HistoryRow,
    MasterRow,
    RaceMeta,
    RankChange,
    ResultRow,
)

#: 같은 경마장으로 보는 저장 라벨 (race_plans 는 prod 에서 '부산경남')
MEET_ALIASES: dict[str, tuple[str, ...]] = {
    "서울": ("서울",),
    "부경": ("부경", "부산경남"),
    "제주": ("제주",),
}

#: read_only_provider 기본 타임아웃 (ms)
STATEMENT_TIMEOUT_MS = 60_000
LOCK_TIMEOUT_MS = 10_000


def meet_aliases(meet: str) -> list[str]:
    """정규화 라벨 → 저장 라벨 후보 ('부경' → ['부경', '부산경남'])."""
    norm = parse.normalize_meet(meet)
    if norm is None:
        return [str(meet)]
    return list(MEET_ALIASES[norm])


def first_post_of(start_times: Sequence[str | None]) -> str | None:
    """발주 시각 목록 → 가장 이른 시각 'HH:MM' (해석 안 되는 값은 무시, 없으면 None).

    races.start_time 은 '9:30'처럼 앞자리 0 이 없을 수 있어 문자열 MIN 대신 (시, 분)으로 비교한다.
    """
    best: tuple[int, str] | None = None
    for raw in start_times:
        minutes = schedule.parse_hhmm(raw)
        label = parse.fmt_hhmm(raw)
        if minutes is None or label is None:
            continue
        if best is None or minutes < best[0]:
            best = (minutes, label)
    return best[1] if best else None


# ---------------------------------------------------------------------------
# SQL (계약 §1)
# ---------------------------------------------------------------------------

# Q0 달력 — races ∩ race_entries. 첫 발주는 Python(first_post_of)이 고른다.
_Q0_CALENDAR = text(
    """
    SELECT r.race_date,
           r.meet,
           COUNT(*)::int AS race_count,
           array_remove(array_agg(NULLIF(btrim(r.start_time), '')), NULL) AS start_times
      FROM races r
     WHERE r.race_date BETWEEN :d_from AND :d_to
       AND r.meet = ANY(CAST(:meets AS text[]))
       AND EXISTS (
             SELECT 1
               FROM race_entries e
              WHERE e.race_date = r.race_date
                AND e.meet = r.meet
                AND e.race_no = r.race_no)
     GROUP BY r.race_date, r.meet
     ORDER BY r.race_date, r.meet
    """
)

# Q1 출전명단 — (D, meet) 전 행 + 배치 시각 + jockey_changes 최신 1건 (meet 미사용, 계약 §1)
_Q1_ENTRIES = text(
    """
    SELECT e.race_date,
           e.meet,
           e.race_no,
           e.horse_no,
           e.chul_no,
           NULLIF(btrim(e.horse_name), '')   AS horse_name,
           NULLIF(btrim(e.jockey_name), '')  AS jockey_name,
           NULLIF(btrim(e.trainer_name), '') AS trainer_name,
           NULLIF(btrim(e.age), '')          AS age,
           NULLIF(btrim(e.sex), '')          AS sex,
           e.rating,
           e.raw ->> 'hrRating'              AS raw_hr_rating,
           e.raw ->> 'wgBudam'               AS raw_wg_budam,
           e.updated_at,
           MAX(e.updated_at) OVER (PARTITION BY e.race_date, e.meet) AS batch_at,
           NULLIF(btrim(jc.jk_name_before), '') AS jc_before,
           NULLIF(btrim(jc.jk_name_after), '')  AS jc_after,
           NULLIF(btrim(jc.reason), '')         AS jc_reason,
           jc.weight_before::text               AS jc_weight_before,
           jc.weight_after::text                AS jc_weight_after
      FROM race_entries e
      LEFT JOIN LATERAL (
            SELECT j.jk_name_before, j.jk_name_after, j.reason, j.weight_before, j.weight_after
              FROM jockey_changes j
             WHERE j.race_date = e.race_date
               AND j.race_no = e.race_no
               AND j.horse_no = e.horse_no
             ORDER BY j.updated_at DESC, j.id DESC
             LIMIT 1
           ) jc ON TRUE
     WHERE e.race_date = :d
       AND e.meet = :meet
     ORDER BY e.race_no, e.chul_no NULLS LAST, e.horse_no
    """
)

# Q6 경주 메타 — races (D, meet) + race_plans (D, race_no, meet 별칭) 최신 1건
_Q6_RACE_META = text(
    """
    SELECT r.race_no,
           NULLIF(btrim(r.race_name), '')  AS race_name,
           r.distance,
           r.raw ->> 'rcDist'              AS raw_rc_dist,
           NULLIF(btrim(r.grade), '')      AS grade,
           NULLIF(btrim(r.track_type), '') AS track_type,
           NULLIF(btrim(r.start_time), '') AS start_time,
           p.plan_name,
           p.plan_grade
      FROM races r
      LEFT JOIN LATERAL (
            SELECT NULLIF(btrim(rp.race_name), '') AS plan_name,
                   NULLIF(btrim(rp.grade), '')     AS plan_grade
              FROM race_plans rp
             WHERE rp.race_date = r.race_date
               AND rp.race_no = r.race_no
               AND rp.meet = ANY(CAST(:plan_meets AS text[]))
             ORDER BY rp.id DESC
             LIMIT 1
           ) p ON TRUE
     WHERE r.race_date = :d
       AND r.meet = :meet
     ORDER BY r.race_no
    """
)

# Q2 이력 — 말별 race_date < :h. field_size 는 그 경주의 결과 행 수:
# 말들의 이력에 나온 (race_date, meet, race_no) 만 모아(k) idx_race_results_date 로 센다.
# meet 은 NULL 일 수 있어 IS NOT DISTINCT FROM 으로 묶는다 (창 함수 PARTITION 과 같은 의미).
_Q2_HISTORY = text(
    """
    WITH h AS (
        SELECT rr.horse_no,
               rr.race_date,
               rr.meet,
               rr.race_no,
               rr.rank,
               rr.record_time::text                 AS record_time,
               NULLIF(btrim(rr.track_condition), '') AS track_condition,
               NULLIF(btrim(rr.jockey_name), '')     AS jockey_name,
               NULLIF(btrim(rr.trainer_name), '')    AS trainer_name,
               rr.raw ->> 'jkNo'                     AS raw_jk_no,
               rr.raw ->> 'hrRating'                 AS raw_hr_rating,
               rr.raw ->> 'wgBudam'                  AS raw_wg_budam,
               rr.raw ->> 'chulNo'                   AS raw_chul_no,
               rr.raw ->> 'rcDist'                   AS raw_rc_dist
          FROM race_results rr
         WHERE rr.horse_no = ANY(CAST(:horse_nos AS text[]))
           AND rr.race_date < :h
    ),
    k AS (
        SELECT DISTINCT race_date, meet, race_no FROM h
    ),
    fs AS (
        SELECT k.race_date, k.meet, k.race_no, COUNT(*)::int AS field_size
          FROM k
          JOIN race_results x
            ON x.race_date = k.race_date
           AND x.race_no = k.race_no
           AND x.meet IS NOT DISTINCT FROM k.meet
         GROUP BY k.race_date, k.meet, k.race_no
    )
    SELECT h.*, ra.distance, fs.field_size
      FROM h
      LEFT JOIN fs
        ON fs.race_date = h.race_date
       AND fs.race_no = h.race_no
       AND fs.meet IS NOT DISTINCT FROM h.meet
      LEFT JOIN races ra
        ON ra.race_date = h.race_date
       AND ra.meet = h.meet
       AND ra.race_no = h.race_no
     ORDER BY h.horse_no, h.race_date, h.race_no
    """
)


def _conn_stats_sql(name_col: str, id_key: str) -> Any:
    """Q3 기수·조교사 집계 — 이름 하나(btrim)로 묶는다 (계약 §1 Q3, §1.1 출주 분류).

    starts·wins·top3 = 같은 meet, race_date ∈ [:lo, :h) 의 출주(rank ≥ 1, 또는 기록 > 0)·1착·3착
    이내. 기록 판정은 Python parse_time_tenths 와 같게 round(record_time*10) > 0.
    distinct_ids = 같은 meet·race_date < :h 전체의 정규화 번호 개수 (NULL·빈 값 제외).
    창 안 출주가 0 인 이름은 돌려주지 않는다 (규칙상 자격 없음과 같다).
    name_col·id_key 는 이 모듈의 고정 값만 넘긴다.
    """
    return text(
        f"""
        SELECT s.name,
               COUNT(*) FILTER (WHERE s.race_date >= :lo AND s.is_start)::int     AS starts,
               COUNT(*) FILTER (WHERE s.race_date >= :lo AND s.rank = 1)::int     AS wins,
               COUNT(*) FILTER (
                   WHERE s.race_date >= :lo AND s.rank BETWEEN 1 AND 3)::int        AS top3,
               COUNT(DISTINCT NULLIF(ltrim(btrim(s.id_raw), '0'), ''))::int        AS distinct_ids
          FROM (
                SELECT btrim(rr.{name_col}) AS name,
                       rr.race_date,
                       rr.rank,
                       COALESCE(rr.rank >= 1 OR round(rr.record_time * 10) > 0, FALSE)
                           AS is_start,
                       rr.raw ->> '{id_key}' AS id_raw
                  FROM race_results rr
                 WHERE btrim(rr.{name_col}) = ANY(CAST(:names AS text[]))
                   AND rr.meet = ANY(CAST(:meets AS text[]))
                   AND rr.race_date < :h
               ) s
         GROUP BY s.name
        HAVING COUNT(*) FILTER (WHERE s.race_date >= :lo AND s.is_start) > 0
         ORDER BY s.name
        """
    )


_Q3_JOCKEY = _conn_stats_sql("jockey_name", "jkNo")
_Q3_TRAINER = _conn_stats_sql("trainer_name", "trNo")

# Q4 등급변동 — 말별 st_date ≤ D 최신 1건
_Q4_RANK_CHANGES = text(
    """
    SELECT DISTINCT ON (c.horse_no)
           c.horse_no,
           c.st_date,
           NULLIF(btrim(c.before_rank), '') AS before_rank,
           NULLIF(btrim(c.after_rank), '')  AS after_rank
      FROM horse_rank_changes c
     WHERE c.horse_no = ANY(CAST(:horse_nos AS text[]))
       AND c.st_date <= :d
     ORDER BY c.horse_no, c.st_date DESC, c.id DESC
    """
)

# Q5 마스터
_Q5_MASTERS = text(
    """
    SELECT h.horse_no, h.total_race_count
      FROM horses h
     WHERE h.horse_no = ANY(CAST(:horse_nos AS text[]))
     ORDER BY h.horse_no
    """
)

_RESULTS_THROUGH = text("SELECT MAX(race_date) FROM race_results WHERE race_date < :h")

_RESULTS_EXIST = text(
    """
    SELECT EXISTS (
        SELECT 1 FROM race_results WHERE race_date = :d AND meet = :meet
    )
    """
)

# 이력 창 [lo, h) 에서 races 는 있는데 race_results 가 없는 경주 → (race_date, meet)
# (periodic._has_unresolved_races_on 과 같은 경주 단위 판정)
_UNRESOLVED = text(
    """
    SELECT DISTINCT r.race_date, r.meet
      FROM races r
     WHERE r.race_date >= :lo
       AND r.race_date < :h
       AND NOT EXISTS (
             SELECT 1
               FROM race_results rr
              WHERE rr.race_date = r.race_date
                AND rr.meet = r.meet
                AND rr.race_no = r.race_no)
     ORDER BY r.race_date, r.meet
    """
)

# 정산 입력 — 결과 (D, meet)
_RESULTS = text(
    """
    SELECT rr.race_no,
           rr.horse_no,
           rr.rank,
           rr.record_time::text AS record_time,
           rr.raw ->> 'chulNo'  AS raw_chul_no
      FROM race_results rr
     WHERE rr.race_date = :d
       AND rr.meet = :meet
     ORDER BY rr.race_no, rr.horse_no
    """
)

# 정산 입력 — 단승 배당 (horse_no 컬럼 = 출전번호 chulNo)
_WIN_DIVIDENDS = text(
    """
    SELECT d.race_no,
           d.horse_no         AS chul_no_text,
           d.win_rate::text   AS win_rate
      FROM race_dividends d
     WHERE d.race_date = :d
       AND d.meet = :meet
     ORDER BY d.race_no, d.horse_no
    """
)


# ---------------------------------------------------------------------------
# provider
# ---------------------------------------------------------------------------


def _rows(conn: Any, sql: Any, params: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return list(conn.execute(sql, dict(params)).mappings().all())


class SqlProvider:
    """`types.Provider` 의 SQL 구현 (계약 §1). conn = Connection 또는 Session."""

    def __init__(self, conn: Any) -> None:
        self.conn = conn

    # ------------------------------------------------------------------ Q0
    def calendar(self, d_from: date, d_to: date, meets: tuple[str, ...]) -> list[CalendarRow]:
        rows = _rows(
            self.conn, _Q0_CALENDAR, {"d_from": d_from, "d_to": d_to, "meets": list(meets)}
        )
        return [
            CalendarRow(
                race_date=r["race_date"],
                meet=r["meet"],
                race_count=int(r["race_count"]),
                first_post=first_post_of(r["start_times"] or []),
            )
            for r in rows
        ]

    # ------------------------------------------------------------------ Q1
    def entries(self, d: date, meet: str) -> list[EntryRow]:
        rows = _rows(self.conn, _Q1_ENTRIES, {"d": d, "meet": meet})
        return [
            EntryRow(
                race_date=r["race_date"],
                meet=r["meet"],
                race_no=int(r["race_no"]),
                horse_no=r["horse_no"],
                chul_no=r["chul_no"],
                horse_name=r["horse_name"],
                jockey_name=r["jockey_name"],
                trainer_name=r["trainer_name"],
                age=r["age"],
                sex=r["sex"],
                rating=r["rating"],
                raw_hr_rating=r["raw_hr_rating"],
                raw_wg_budam=r["raw_wg_budam"],
                updated_at=r["updated_at"],
                batch_at=r["batch_at"],
                jc_before=r["jc_before"],
                jc_after=r["jc_after"],
                jc_reason=r["jc_reason"],
                jc_weight_before=r["jc_weight_before"],
                jc_weight_after=r["jc_weight_after"],
            )
            for r in rows
        ]

    # ------------------------------------------------------------------ Q6
    def race_meta(self, d: date, meet: str) -> list[RaceMeta]:
        rows = _rows(
            self.conn,
            _Q6_RACE_META,
            {"d": d, "meet": meet, "plan_meets": meet_aliases(meet)},
        )
        return [
            RaceMeta(
                race_no=int(r["race_no"]),
                race_name=r["race_name"],
                distance=r["distance"],
                raw_rc_dist=r["raw_rc_dist"],
                grade=r["grade"],
                track_type=r["track_type"],
                start_time=r["start_time"],
                plan_name=r["plan_name"],
                plan_grade=r["plan_grade"],
            )
            for r in rows
        ]

    # ------------------------------------------------------------------ Q2
    def history(self, horse_nos: list[str], h: date) -> list[HistoryRow]:
        if not horse_nos:
            return []
        rows = _rows(self.conn, _Q2_HISTORY, {"horse_nos": list(horse_nos), "h": h})
        return [
            HistoryRow(
                horse_no=r["horse_no"],
                race_date=r["race_date"],
                meet=r["meet"],
                race_no=int(r["race_no"]),
                rank=r["rank"],
                record_time=r["record_time"],
                track_condition=r["track_condition"],
                jockey_name=r["jockey_name"],
                trainer_name=r["trainer_name"],
                raw_jk_no=r["raw_jk_no"],
                raw_hr_rating=r["raw_hr_rating"],
                raw_wg_budam=r["raw_wg_budam"],
                raw_chul_no=r["raw_chul_no"],
                distance=r["distance"],
                raw_rc_dist=r["raw_rc_dist"],
                field_size=r["field_size"],
            )
            for r in rows
        ]

    # ------------------------------------------------------------------ Q3
    def _conn_stats(
        self, sql: Any, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        clean = sorted({n for n in (parse.norm_name(x) for x in names) if n is not None})
        if not clean:
            return []
        rows = _rows(
            self.conn,
            sql,
            {
                "names": clean,
                "meets": meet_aliases(meet),
                "h": h,
                "lo": h - timedelta(days=int(window_days)),
            },
        )
        return [
            ConnStat(
                name=r["name"],
                starts=int(r["starts"]),
                wins=int(r["wins"]),
                top3=int(r["top3"]),
                distinct_ids=int(r["distinct_ids"]),
            )
            for r in rows
        ]

    def jockey_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        return self._conn_stats(_Q3_JOCKEY, names, meet, h, window_days)

    def trainer_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        """distinct_ids 는 raw trNo 기준으로 함께 세지만 r1 조교사 기준은 쓰지 않는다."""
        return self._conn_stats(_Q3_TRAINER, names, meet, h, window_days)

    # ------------------------------------------------------------------ Q4 · Q5
    def rank_changes(self, horse_nos: list[str], d: date) -> list[RankChange]:
        if not horse_nos:
            return []
        rows = _rows(self.conn, _Q4_RANK_CHANGES, {"horse_nos": list(horse_nos), "d": d})
        return [
            RankChange(
                horse_no=r["horse_no"],
                st_date=r["st_date"],
                before_rank=r["before_rank"],
                after_rank=r["after_rank"],
            )
            for r in rows
        ]

    def masters(self, horse_nos: list[str]) -> list[MasterRow]:
        if not horse_nos:
            return []
        rows = _rows(self.conn, _Q5_MASTERS, {"horse_nos": list(horse_nos)})
        return [
            MasterRow(horse_no=r["horse_no"], total_race_count=r["total_race_count"])
            for r in rows
        ]

    # ------------------------------------------------------------------ 도장·가드
    def results_through(self, h: date) -> date | None:
        return self.conn.execute(_RESULTS_THROUGH, {"h": h}).scalar()

    def results_exist(self, d: date, meet: str) -> bool:
        return bool(self.conn.execute(_RESULTS_EXIST, {"d": d, "meet": meet}).scalar())

    def unresolved_races(self, h: date, days: int) -> list[tuple[date, str]]:
        rows = _rows(self.conn, _UNRESOLVED, {"h": h, "lo": h - timedelta(days=int(days))})
        return [(r["race_date"], r["meet"]) for r in rows]

    # ------------------------------------------------------------------ 정산 입력
    def results(self, d: date, meet: str) -> list[ResultRow]:
        rows = _rows(self.conn, _RESULTS, {"d": d, "meet": meet})
        return [
            ResultRow(
                race_no=int(r["race_no"]),
                horse_no=r["horse_no"],
                rank=r["rank"],
                record_time=r["record_time"],
                raw_chul_no=r["raw_chul_no"],
            )
            for r in rows
        ]

    def win_dividends(self, d: date, meet: str) -> list[DividendRow]:
        rows = _rows(self.conn, _WIN_DIVIDENDS, {"d": d, "meet": meet})
        return [
            DividendRow(
                race_no=int(r["race_no"]),
                chul_no_text=r["chul_no_text"],
                win_rate=r["win_rate"],
            )
            for r in rows
        ]


# ---------------------------------------------------------------------------
# READ ONLY 트랜잭션
# ---------------------------------------------------------------------------

SessionFactory = Callable[[], AbstractContextManager[Any]]


def default_session_factory() -> SessionFactory:
    """src.db.session_scope — 호출 시점에 조회한다 (e2e 가 엔진·SessionLocal 을 바꿔 끼운다)."""
    from ..db import session_scope

    return session_scope


@contextmanager
def read_only_provider(
    session_factory: SessionFactory | None = None,
    *,
    statement_timeout_ms: int = STATEMENT_TIMEOUT_MS,
    lock_timeout_ms: int = LOCK_TIMEOUT_MS,
) -> Iterator[SqlProvider]:
    """새 READ ONLY 트랜잭션 하나에서 SqlProvider 를 연다 (블록을 나가면 끝).

    session_factory() 는 "들어가면 새 트랜잭션" 인 컨텍스트 매니저 (기본 src.db.session_scope).
    SET TRANSACTION 이 첫 문장이어야 하므로 이미 쓰던 세션은 넘기지 않는다.
    """
    factory = session_factory if session_factory is not None else default_session_factory()
    with factory() as conn:
        conn.execute(text("SET TRANSACTION READ ONLY"))
        conn.execute(
            text(
                "SELECT set_config('statement_timeout', :st, true),"
                " set_config('lock_timeout', :lt, true)"
            ),
            {"st": str(int(statement_timeout_ms)), "lt": str(int(lock_timeout_ms))},
        )
        yield SqlProvider(conn)
