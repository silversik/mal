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
- meet: 인자는 정규화 라벨('서울'·'부경'·'제주'). **저장 라벨은 한 가지가 아니다** — prod 의
  부경은 테이블·시기에 따라 '부경' 과 '부산경남' 이 섞여 있다 (race_entries·race_plans 는 전부
  '부산경남', race_results·race_dividends 는 2026-08-16 부터 '부산경남', races 는 같은 경주가 두
  라벨로 따로 있을 수 있다 — KRA 응답이 코드 대신 한글로 오면 그대로 저장되기 때문).
  그래서 (D, meet) 로 찾는 모든 조회는 `meet_aliases` 로 읽고, 두 테이블을 잇는 조인은
  `norm_meet_sql` 로 정규화해 비교한다. 같은 경주·말이 두 라벨로 겹치면 한 행만 남긴다
  (정규 라벨 우선 — `_merge_race_meta` · `_dedupe`). 달력·출전명단이 돌려주는 meet 은 정규화 라벨,
  이력(Q2)의 meet 은 저장값 그대로다 (features 가 정규화).

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


def expand_meets(meets: Sequence[str]) -> list[str]:
    """정규화 라벨 여러 개 → 저장 라벨 후보 전체 (중복 없이, 정렬)."""
    return sorted({a for m in meets for a in meet_aliases(m)})


def norm_meet_sql(col: str) -> str:
    """저장 라벨 컬럼 → 정규화 라벨 SQL 식 (`parse.normalize_meet` 의 SQL 판).

    MEET_ALIASES 에서 만든다 ('부산경남' → '부경').

    별칭이 없는 값(서울·제주·영천·NULL …)은 그대로 둔다. col 은 이 모듈의 고정 값만 넘긴다.
    """
    whens = " ".join(
        f"WHEN '{alias}' THEN '{norm}'"
        for norm, labels in MEET_ALIASES.items()
        for alias in labels
        if alias != norm
    )
    return f"(CASE {col} {whens} ELSE {col} END)" if whens else col


def _canonical(meet: str) -> str:
    """인자 meet 의 정규화 라벨 (정규화가 안 되는 값은 그대로)."""
    return parse.normalize_meet(meet) or str(meet)


def _dedupe(
    rows: Sequence[Mapping[str, Any]],
    key: Callable[[Mapping[str, Any]], Any],
    rank: Callable[[Mapping[str, Any]], Any],
) -> list[Mapping[str, Any]]:
    """key 가 같은 행 중 rank 가 가장 작은 한 행만 남긴다 (처음 나온 자리 유지).

    같은 경주·말이 '부경'·'부산경남' 두 라벨로 겹쳐 저장됐을 때 두 번 세지 않기 위한 것.
    """
    best: dict[Any, Mapping[str, Any]] = {}
    for r in rows:
        k = key(r)
        if k not in best or rank(r) < rank(best[k]):
            best[k] = r
    return list(best.values())


_META_FIELDS = (
    "race_name", "distance", "raw_rc_dist", "grade", "track_type", "start_time",
    "plan_name", "plan_grade",
)


def _merge_race_meta(rows: Sequence[Mapping[str, Any]]) -> list[RaceMeta]:
    """Q6 행(race_no, 정규 라벨 우선 순) → 경주당 RaceMeta 하나.

    같은 경주가 두 라벨의 races 행으로 있으면 필드마다 처음 나온 NULL 아닌 값을 쓴다.
    """
    merged: dict[int, dict[str, Any]] = {}
    for r in rows:
        cur = merged.setdefault(int(r["race_no"]), dict.fromkeys(_META_FIELDS))
        for f in _META_FIELDS:
            if cur[f] is None and r[f] is not None:
                cur[f] = r[f]
    return [RaceMeta(race_no=n, **merged[n]) for n in sorted(merged)]


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

# Q0 달력 — races ∩ race_entries (라벨은 정규화해 비교). 첫 발주는 Python(first_post_of)이 고른다.
# 같은 경주가 두 라벨의 races 행으로 있으면 한 번만 센다 (발주 시각 있는 행 → 정규 라벨 순).
_Q0_CALENDAR = text(
    f"""
    SELECT c.race_date,
           c.meet,
           COUNT(*)::int AS race_count,
           array_remove(array_agg(c.start_time), NULL) AS start_times
      FROM (
            SELECT DISTINCT ON (r.race_date, {norm_meet_sql("r.meet")}, r.race_no)
                   r.race_date,
                   {norm_meet_sql("r.meet")}      AS meet,
                   r.race_no,
                   NULLIF(btrim(r.start_time), '') AS start_time
              FROM races r
             WHERE r.race_date BETWEEN :d_from AND :d_to
               AND r.meet = ANY(CAST(:meets AS text[]))
               AND EXISTS (
                     SELECT 1
                       FROM race_entries e
                      WHERE e.race_date = r.race_date
                        AND e.meet = ANY(CAST(:meets AS text[]))
                        AND {norm_meet_sql("e.meet")} = {norm_meet_sql("r.meet")}
                        AND e.race_no = r.race_no
                        AND e.scratched_at IS NULL)
             ORDER BY r.race_date,
                      {norm_meet_sql("r.meet")},
                      r.race_no,
                      (NULLIF(btrim(r.start_time), '') IS NULL),
                      (r.meet <> {norm_meet_sql("r.meet")}),
                      r.meet
           ) c
     GROUP BY c.race_date, c.meet
     ORDER BY c.race_date, c.meet
    """
)

# Q1 출전명단 — (D, meet 별칭) 출전취소(scratched_at) 아닌 행
#   + 배치 시각 + jockey_changes 최신 1건 (meet 미사용, 계약 §1)
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
           MAX(e.updated_at) OVER (PARTITION BY e.race_date) AS batch_at,
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
       AND e.meet = ANY(CAST(:meets AS text[]))
       AND e.scratched_at IS NULL
     ORDER BY e.race_no, e.chul_no NULLS LAST, e.horse_no, e.meet
    """
)

# Q6 경주 메타 — races (D, meet 별칭) + race_plans (D, race_no, meet 별칭) 최신 1건.
# 같은 경주의 두 라벨 행은 Python(_merge_race_meta)이 합친다 — 정규 라벨 행을 먼저 준다.
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
               AND rp.meet = ANY(CAST(:meets AS text[]))
             ORDER BY rp.id DESC
             LIMIT 1
           ) p ON TRUE
     WHERE r.race_date = :d
       AND r.meet = ANY(CAST(:meets AS text[]))
     ORDER BY r.race_no, (r.meet <> :meet), r.meet
    """
)

# Q2 이력 — 말별 race_date < :h. field_size 는 그 경주의 결과 행 수:
# 말들의 이력에 나온 (race_date, meet, race_no) 만 모아(k) idx_race_results_date 로 센다.
# meet 은 NULL 일 수 있어 IS NOT DISTINCT FROM 으로 묶는다 (창 함수 PARTITION 과 같은 의미).
# 거리는 races 에서 — 결과와 races 의 라벨이 다를 수 있어('부산경남' 결과 ↔ '부경' races) 정규화해
# 잇고, 두 라벨 행이 다 있으면 거리가 있는 행 → 결과와 같은 라벨 순으로 하나만 고른다.
_Q2_HISTORY = text(
    f"""
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
      LEFT JOIN LATERAL (
            SELECT x.distance
              FROM races x
             WHERE x.race_date = h.race_date
               AND x.race_no = h.race_no
               AND {norm_meet_sql("x.meet")} = {norm_meet_sql("h.meet")}
             ORDER BY (x.distance IS NULL), (x.meet <> h.meet), x.meet
             LIMIT 1
           ) ra ON TRUE
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

    안쪽 SELECT 가 번호를 정규화(id_norm)해 raw 를 버리고, `OFFSET 0` 이 그 하위 질의를 끌어올리지
    못하게 막는다 — 펜스가 없으면 planner 가 하위 질의를 풀어 COUNT(DISTINCT …) 를 위한 정렬에
    race_results.raw(행당 ~1.4KB) 를 싣고 가서 호당 수백 MB 의 임시 파일을 쓴다
    (과거 시험은 호당 2회).
    """
    return text(
        f"""
        SELECT s.name,
               COUNT(*) FILTER (WHERE s.race_date >= :lo AND s.is_start)::int     AS starts,
               COUNT(*) FILTER (WHERE s.race_date >= :lo AND s.rank = 1)::int     AS wins,
               COUNT(*) FILTER (
                   WHERE s.race_date >= :lo AND s.rank BETWEEN 1 AND 3)::int        AS top3,
               COUNT(DISTINCT s.id_norm)::int                                      AS distinct_ids
          FROM (
                SELECT btrim(rr.{name_col}) AS name,
                       rr.race_date,
                       rr.rank,
                       COALESCE(rr.rank >= 1 OR round(rr.record_time * 10) > 0, FALSE)
                           AS is_start,
                       NULLIF(ltrim(btrim(rr.raw ->> '{id_key}'), '0'), '') AS id_norm
                  FROM race_results rr
                 WHERE btrim(rr.{name_col}) = ANY(CAST(:names AS text[]))
                   AND rr.meet = ANY(CAST(:meets AS text[]))
                   AND rr.race_date < :h
                OFFSET 0  -- 펜스: 끌어올리면 raw 가 정렬로 딸려 간다 (위 설명)
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
        SELECT 1 FROM race_results
         WHERE race_date = :d AND meet = ANY(CAST(:meets AS text[]))
    )
    """
)

# 이력 창 [lo, h) 에서 races 는 있는데 race_results 가 없는 경주 → (race_date, 정규화 meet)
# (periodic._has_unresolved_races_on 과 같은 경주 단위 판정). 라벨은 정규화해 비교한다 —
# races '부경' ↔ 결과 '부산경남' 을 미해결로 잘못 세지 않게.
_UNRESOLVED = text(
    f"""
    SELECT DISTINCT r.race_date, {norm_meet_sql("r.meet")} AS meet
      FROM races r
     WHERE r.race_date >= :lo
       AND r.race_date < :h
       AND NOT EXISTS (
             SELECT 1
               FROM race_results rr
              WHERE rr.race_date = r.race_date
                AND {norm_meet_sql("rr.meet")} = {norm_meet_sql("r.meet")}
                AND rr.race_no = r.race_no)
     ORDER BY 1, 2
    """
)

# 정산 입력 — 결과 (D, meet 별칭). 같은 말이 두 라벨로 겹치면 정규 라벨 행 (Python _dedupe)
_RESULTS = text(
    """
    SELECT rr.race_no,
           rr.horse_no,
           rr.meet,
           rr.rank,
           rr.record_time::text AS record_time,
           rr.raw ->> 'chulNo'  AS raw_chul_no
      FROM race_results rr
     WHERE rr.race_date = :d
       AND rr.meet = ANY(CAST(:meets AS text[]))
     ORDER BY rr.race_no, rr.horse_no, rr.meet
    """
)

# 정산 입력 — 단승 배당 (horse_no 컬럼 = 출전번호 chulNo)
_WIN_DIVIDENDS = text(
    """
    SELECT d.race_no,
           d.horse_no         AS chul_no_text,
           d.meet,
           d.win_rate::text   AS win_rate
      FROM race_dividends d
     WHERE d.race_date = :d
       AND d.meet = ANY(CAST(:meets AS text[]))
     ORDER BY d.race_no, d.horse_no, d.meet
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
            self.conn,
            _Q0_CALENDAR,
            {"d_from": d_from, "d_to": d_to, "meets": expand_meets(meets)},
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
        canon = _canonical(meet)
        rows = _dedupe(
            _rows(self.conn, _Q1_ENTRIES, {"d": d, "meets": meet_aliases(meet)}),
            key=lambda r: (r["race_no"], r["horse_no"]),
            # 최신 수집 행 → 정규 라벨 순
            rank=lambda r: (
                r["updated_at"] is None,
                -(r["updated_at"].timestamp() if r["updated_at"] is not None else 0.0),
                r["meet"] != canon,
                r["meet"],
            ),
        )
        return [
            EntryRow(
                race_date=r["race_date"],
                meet=canon,
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
            {"d": d, "meet": _canonical(meet), "meets": meet_aliases(meet)},
        )
        return _merge_race_meta(rows)

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
        return bool(
            self.conn.execute(_RESULTS_EXIST, {"d": d, "meets": meet_aliases(meet)}).scalar()
        )

    def unresolved_races(self, h: date, days: int) -> list[tuple[date, str]]:
        rows = _rows(self.conn, _UNRESOLVED, {"h": h, "lo": h - timedelta(days=int(days))})
        return [(r["race_date"], r["meet"]) for r in rows]

    # ------------------------------------------------------------------ 정산 입력
    def results(self, d: date, meet: str) -> list[ResultRow]:
        canon = _canonical(meet)
        rows = _dedupe(
            _rows(self.conn, _RESULTS, {"d": d, "meets": meet_aliases(meet)}),
            key=lambda r: (r["race_no"], r["horse_no"]),
            rank=lambda r: (r["meet"] != canon, r["meet"]),
        )
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
        canon = _canonical(meet)
        rows = _dedupe(
            _rows(self.conn, _WIN_DIVIDENDS, {"d": d, "meets": meet_aliases(meet)}),
            key=lambda r: (r["race_no"], r["chul_no_text"]),
            rank=lambda r: (r["meet"] != canon, r["meet"]),
        )
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
