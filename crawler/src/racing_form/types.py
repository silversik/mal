"""경마지 provider 행 타입 + Provider 프로토콜.

- 순수 모듈(features·rules·news·payload·build·settle)은 DB 를 모른다. 입력은 전부 이 파일의
  frozen dataclass 로 받는다. SQL provider(queries.py, 별도 작성)가 `Provider` 를 구현한다.
- 값은 모두 plain Python(str·int·date·datetime·None). DB numeric 은 **TEXT 문자열**로 넘긴다
  (Decimal·float 금지 — `parse.py` 가 0.1 단위 정수로 바꾼다). jsonb 는 `raw->>'key'` 텍스트.
- 이름은 SQL 에서 btrim 하지 않아도 된다 — Python 이 strip() 하고 빈 문자열은 None 으로 본다.
- datetime 은 timezone-aware 여야 한다 (timestamptz).

질의 의미는 docs/spec/racing-form-contract.md §1 (Q0~Q6) 이 정본이다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class CalendarRow:
    """Q0 달력 — 발행 대상 (경주일, 경마장).

    race_count: races ∩ race_entries 경주 수.
    first_post: `MIN(NULLIF(btrim(start_time),''))` ('HH:MM'), 모르면 None.
    """

    race_date: date
    meet: str
    race_count: int
    first_post: str | None


@dataclass(frozen=True)
class EntryRow:
    """Q1 출전명단 한 행 (race_entries + jockey_changes LATERAL 최신 1건).

    batch_at: `MAX(updated_at) OVER (PARTITION BY race_date, meet)` (배치 시각).
    jc_*: jockey_changes 행이 없으면 모두 None. jc_weight_* 는 numeric 텍스트.
    raw_hr_rating / raw_wg_budam: `raw->>'hrRating'` / `raw->>'wgBudam'` 텍스트.
    """

    race_date: date
    meet: str
    race_no: int
    horse_no: str
    chul_no: int | None
    horse_name: str | None
    jockey_name: str | None
    trainer_name: str | None
    age: str | None
    sex: str | None
    rating: int | None
    raw_hr_rating: str | None
    raw_wg_budam: str | None
    updated_at: datetime
    batch_at: datetime
    jc_before: str | None = None
    jc_after: str | None = None
    jc_reason: str | None = None
    jc_weight_before: str | None = None
    jc_weight_after: str | None = None

    @property
    def has_jockey_change(self) -> bool:
        """jockey_changes 행이 붙어 있는지 (LEFT JOIN 결과가 전부 NULL 이 아님)."""
        return any(
            v is not None
            for v in (
                self.jc_before,
                self.jc_after,
                self.jc_reason,
                self.jc_weight_before,
                self.jc_weight_after,
            )
        )


@dataclass(frozen=True)
class RaceMeta:
    """Q6 경주 메타 (races + race_plans).

    distance: races.distance, raw_rc_dist: races.raw->>'rcDist' 텍스트.
    plan_name / plan_grade: race_plans
    (race_date = D, race_no, meet ∈ {meet, '부경'이면 '부산경남'})
    매칭 행의 race_name / grade. 매칭이 없으면 None.
    """

    race_no: int
    race_name: str | None = None
    distance: int | None = None
    raw_rc_dist: str | None = None
    grade: str | None = None
    track_type: str | None = None
    start_time: str | None = None
    plan_name: str | None = None
    plan_grade: str | None = None


@dataclass(frozen=True)
class HistoryRow:
    """Q2 이력 한 행 (race_results, race_date < H) + races 거리.

    record_time: race_results.record_time(초) numeric 텍스트 ("72.80").
    raw_*: race_results.raw->>'jkNo' / 'hrRating' / 'wgBudam' / 'chulNo' 텍스트.
    distance: races.distance (LEFT JOIN), raw_rc_dist: race_results.raw->>'rcDist'.
    field_size: 그 경주의 결과 행 수 (COUNT(*) OVER (PARTITION BY race_date, meet, race_no)).
    meet: race_results.meet 원문 (Python 이 '부산경남' → '부경' 정규화).
    """

    horse_no: str
    race_date: date
    meet: str | None
    race_no: int
    rank: int | None = None
    record_time: str | None = None
    track_condition: str | None = None
    jockey_name: str | None = None
    trainer_name: str | None = None
    raw_jk_no: str | None = None
    raw_hr_rating: str | None = None
    raw_wg_budam: str | None = None
    raw_chul_no: str | None = None
    distance: int | None = None
    raw_rc_dist: str | None = None
    field_size: int | None = None


@dataclass(frozen=True)
class ConnStat:
    """Q3 기수·조교사 집계 (이름 하나 = btrim 이름).

    starts·wins·top3: 같은 meet, race_date ∈ [H − window_days, H) 의
    출주(계약 §1.1) 수·1착·3착 이내.
    distinct_ids: 같은 meet·race_date < H 전체에서
    `COUNT(DISTINCT NULLIF(ltrim(btrim(raw->>'jkNo'),'0'),''))` (NULL 제외) — 2 이상이면 동명이인.
    조교사 집계는 distinct_ids 를 쓰지 않는다 (0).
    """

    name: str
    starts: int
    wins: int
    top3: int
    distinct_ids: int = 0


@dataclass(frozen=True)
class RankChange:
    """Q4 등급변동 — 말별 st_date ≤ D 최신 1건."""

    horse_no: str
    st_date: date
    before_rank: str | None
    after_rank: str | None


@dataclass(frozen=True)
class MasterRow:
    """Q5 마스터 — horses.total_race_count."""

    horse_no: str
    total_race_count: int | None


@dataclass(frozen=True)
class ResultRow:
    """정산 입력 — race_results (D, meet).

    record_time 은 numeric 텍스트, raw_chul_no 는 raw->>'chulNo'.
    """

    race_no: int
    horse_no: str
    rank: int | None
    record_time: str | None
    raw_chul_no: str | None


@dataclass(frozen=True)
class DividendRow:
    """정산 입력 — race_dividends (D, meet) 단승.

    chul_no_text: race_dividends.horse_no 컬럼 (**출전번호 chulNo 가 들어 있다**).
    win_rate: numeric 텍스트 ("3.4"), 없으면 None.
    """

    race_no: int
    chul_no_text: str
    win_rate: str | None


@runtime_checkable
class Provider(Protocol):
    """경마지 입력 조회 인터페이스. SQL 구현은 READ ONLY 트랜잭션에서 계약 §1 의 질의를 실행한다.

    모든 메서드는 부작용이 없어야 한다. 이력 계열은 **race_date < h** 를 SQL 에서 강제한다
    (features.assert_strictly_before 가 Python 에서 한 번 더 막는다).
    """

    def calendar(self, d_from: date, d_to: date, meets: tuple[str, ...]) -> list[CalendarRow]:
        """Q0 — d_from ≤ race_date ≤ d_to, meet ∈ meets 인 races 중
        race_entries 가 있는 (D, meet)."""
        ...

    def entries(self, d: date, meet: str) -> list[EntryRow]:
        """Q1 — race_entries (d, meet) 전 행 (stale·중복 포함, 걸러내기는 Python)."""
        ...

    def race_meta(self, d: date, meet: str) -> list[RaceMeta]:
        """Q6 — races (d, meet) + race_plans 매칭."""
        ...

    def history(self, horse_nos: list[str], h: date) -> list[HistoryRow]:
        """Q2 — race_results rr WHERE rr.horse_no = ANY(:horse_nos) AND rr.race_date < :h."""
        ...

    def jockey_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        """Q3 기수 — btrim(jockey_name) = ANY(:names), 결과가 없는 이름은 생략해도 된다."""
        ...

    def trainer_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        """Q3 조교사 — btrim(trainer_name) = ANY(:names)."""
        ...

    def rank_changes(self, horse_nos: list[str], d: date) -> list[RankChange]:
        """Q4 — horse_rank_changes (horse_no = ANY, st_date ≤ d), 말별 최신 1건."""
        ...

    def masters(self, horse_nos: list[str]) -> list[MasterRow]:
        """Q5 — horses (horse_no = ANY)."""
        ...

    def results_through(self, h: date) -> date | None:
        """`SELECT MAX(race_date) FROM race_results WHERE race_date < :h`."""
        ...

    def results_exist(self, d: date, meet: str) -> bool:
        """`EXISTS (SELECT 1 FROM race_results WHERE race_date = :d AND meet = :meet)`."""
        ...

    def unresolved_races(self, h: date, days: int) -> list[tuple[date, str]]:
        """이력 창 [h − days, h) 에서 races(또는 출전표)는 있는데 결과가 없는 (race_date, meet)."""
        ...

    def results(self, d: date, meet: str) -> list[ResultRow]:
        """정산 — race_results (d, meet) 전 경주."""
        ...

    def win_dividends(self, d: date, meet: str) -> list[DividendRow]:
        """정산 — race_dividends (d, meet) 단승 배당 (horse_no 컬럼 = chulNo)."""
        ...
