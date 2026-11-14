"""경마지 특징 계산 (순수 함수) — 계약 §1.1 출주 분류 · §1.2 활성 출전마 · §1.3 말별 값.

as-of: 이력은 race_date < H 만 쓴다. provider(SQL)가 걸러 주지만 `assert_strictly_before` 로
Python 에서 한 번 더 막는다 (둘 중 하나가 깨져도 누수가 나지 않게).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from . import parse
from .definitions import RuleSetDef
from .types import EntryRow, HistoryRow

# ---------------------------------------------------------------------------
# §1.1 출주 분류
# ---------------------------------------------------------------------------

RANKED = "ranked"  # 출주 (착순 있음)
UNRANKED = "unranked"  # 출주 (착순 없음 — 실격 등, 기록 있음). 입상 아님, 화면 "순위 없음"


def classify_start(rank: int | None, time_tenths: int | None) -> str | None:
    """race_results 한 행의 출주 분류. None = 미출주 (이력에서 제외).

    - rank ≥ 1 → RANKED
    - rank NULL/0 이고 기록 > 0 → UNRANKED
    - rank NULL/0 이고 기록 없음 → None
    """
    if rank is not None and rank >= 1:
        return RANKED
    if time_tenths is not None and time_tenths > 0:
        return UNRANKED
    return None


# ---------------------------------------------------------------------------
# §1.2 · §1.3 출전마
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class JockeyChange:
    """발행 시점 jockey_changes 최신 1건 (이름은 strip, 부담은 0.1kg 정수)."""

    before: str | None
    after: str | None
    reason: str | None
    weight_before_tenths: int | None
    weight_after_tenths: int | None

    def to_json(self) -> dict[str, Any]:
        return {
            "before": self.before,
            "after": self.after,
            "reason": self.reason,
            "weight_before_tenths": self.weight_before_tenths,
            "weight_after_tenths": self.weight_after_tenths,
        }


@dataclass(frozen=True)
class Runner:
    """활성 출전마 한 두 (발행 시점 값)."""

    race_no: int
    horse_no: str
    chul_no: int
    horse_name: str | None
    jockey_name: str | None  # 실제 기수 = strip(COALESCE(jc.jk_name_after, e.jockey_name))
    trainer_name: str | None
    age: str | None
    sex: str | None
    rating: int | None  # 출전표 rating(>0), 없으면 raw hrRating
    budam_tenths: int | None  # 유효 부담 = jc.weight_after → raw wgBudam
    jockey_change: JockeyChange | None
    updated_at: datetime


def entry_rating(row: EntryRow) -> int | None:
    """레이팅: race_entries.rating(>0), 없으면 raw hrRating 정수. 0 이하·실패 = None."""
    r = parse.parse_rating(row.rating)
    return r if r is not None else parse.parse_rating(row.raw_hr_rating)


def effective_jockey(row: EntryRow) -> str | None:
    """실제 기수 — 기수변경 after 가 있으면 그것, 없으면 출전표 기수 (빈 문자열 = NULL)."""
    return parse.norm_name(row.jc_after) or parse.norm_name(row.jockey_name)


def effective_budam_tenths(row: EntryRow) -> int | None:
    """유효 부담(0.1kg) — jockey_changes.weight_after 가 있으면 그것, 없으면 raw wgBudam."""
    after = parse.parse_tenths(row.jc_weight_after)
    return after if after is not None else parse.parse_tenths(row.raw_wg_budam)


def jockey_change_of(row: EntryRow) -> JockeyChange | None:
    if not row.has_jockey_change:
        return None
    return JockeyChange(
        before=parse.norm_name(row.jc_before),
        after=parse.norm_name(row.jc_after),
        reason=parse.norm_name(row.jc_reason),
        weight_before_tenths=parse.parse_tenths(row.jc_weight_before),
        weight_after_tenths=parse.parse_tenths(row.jc_weight_after),
    )


def to_runner(row: EntryRow) -> Runner:
    if row.chul_no is None:
        raise ValueError(f"chul_no 없음: {row.race_no}R {row.horse_no}")
    return Runner(
        race_no=row.race_no,
        horse_no=str(row.horse_no).strip(),
        chul_no=int(row.chul_no),
        horse_name=parse.norm_name(row.horse_name),
        jockey_name=effective_jockey(row),
        trainer_name=parse.norm_name(row.trainer_name),
        age=parse.norm_name(row.age),
        sex=parse.norm_name(row.sex),
        rating=entry_rating(row),
        budam_tenths=effective_budam_tenths(row),
        jockey_change=jockey_change_of(row),
        updated_at=row.updated_at,
    )


def entries_batch_at(rows: Sequence[EntryRow]) -> datetime | None:
    """출전표 최신 배치 시각 = MAX(updated_at) (행의 batch_at 도 함께 본다)."""
    if not rows:
        return None
    return max(max(r.batch_at, r.updated_at) for r in rows)


def select_active_entries(
    rows: Sequence[EntryRow], defn: RuleSetDef
) -> tuple[dict[int, list[Runner]], list[str]]:
    """Q1 행 → 경주별 활성 출전마 (출전번호 순) + 경고. 계약 §1.2.

    1. horse_no 가 비었거나 meet 가 서울·부경·제주가 아니면 제외. 출전번호(chul_no)가 없는 행도
       제외하고 경고 `missing_chul_no:<race_no>` (화면·정렬의 기준값이라 없으면 실을 수 없다).
    2. stale: updated_at < 배치 시각 − batch_tolerance_min 이면 제외. 단 한 경주에서 제외 비율이
       max_drop_pct 를 넘으면 그 경주는 빼지 않고 경고 `stale_kept:<race_no>`.
    3. 같은 날 같은 말이 두 경주에 있으면 updated_at 최신 행 1개만 (동률이면 race_no 큰 쪽).

    반환 dict 에는 1 단계를 통과한 행이 있던 경주가 모두 들어 있다(3 단계로 0두가 된 경주 포함).
    경주별 N < field.min_active 판정(small_field)은 rules 가 한다.
    """
    warnings: list[str] = []
    if not rows:
        return {}, warnings

    batch = entries_batch_at(rows)
    assert batch is not None
    cutoff = batch - timedelta(minutes=int(defn.p("stale", "batch_tolerance_min")))
    max_drop_pct = int(defn.p("stale", "max_drop_pct"))

    # 1. 제외
    by_race: dict[int, list[EntryRow]] = defaultdict(list)
    missing_chul: set[int] = set()
    for r in rows:
        if parse.norm_name(r.horse_no) is None or parse.normalize_meet(r.meet) is None:
            continue
        if r.chul_no is None:
            missing_chul.add(r.race_no)
            continue
        by_race[r.race_no].append(r)

    # 2. stale
    kept: list[EntryRow] = []
    for race_no in sorted(by_race):
        race_rows = by_race[race_no]
        stale = [r for r in race_rows if r.updated_at < cutoff]
        if stale and len(stale) * 100 > max_drop_pct * len(race_rows):
            warnings.append(f"stale_kept:{race_no}")
            kept.extend(race_rows)
        else:
            kept.extend(r for r in race_rows if r.updated_at >= cutoff)

    # 3. 같은 날 중복 — 최신 행 (동률이면 race_no 큰 쪽)
    best: dict[str, EntryRow] = {}
    for r in kept:
        key = str(r.horse_no).strip()
        cur = best.get(key)
        if cur is None or (r.updated_at, r.race_no) > (cur.updated_at, cur.race_no):
            best[key] = r

    out: dict[int, list[Runner]] = {race_no: [] for race_no in sorted(by_race)}
    for r in kept:
        if best[str(r.horse_no).strip()] is r:
            out[r.race_no].append(to_runner(r))
    for race_no in out:
        out[race_no].sort(key=lambda x: (x.chul_no, x.horse_no))

    warnings.extend(f"missing_chul_no:{race_no}" for race_no in sorted(missing_chul))
    return out, warnings


def race_distance(distance: Any, raw_rc_dist: Any, defn: RuleSetDef) -> int | None:
    """거리 = COALESCE(races.distance, raw rcDist) → 800~3000m 만 (밖이면 None)."""
    value = distance if distance is not None else raw_rc_dist
    return parse.parse_distance(value, defn)


# ---------------------------------------------------------------------------
# as-of 이중 차단
# ---------------------------------------------------------------------------


def assert_strictly_before(rows: Iterable[HistoryRow], h: date) -> None:
    """이력 행 중 race_date ≥ h 가 하나라도 있으면 ValueError (as-of 누수 차단)."""
    bad = [r for r in rows if r.race_date >= h]
    if bad:
        first = min(bad, key=lambda r: (r.race_date, r.horse_no))
        raise ValueError(
            f"as-of 위반: 이력 {len(bad)}행이 기준일 {h.isoformat()} 이후 "
            f"(예: {first.horse_no} {first.race_date.isoformat()} {first.race_no}R)"
        )


# ---------------------------------------------------------------------------
# 말별 특징
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Start:
    """이력의 출주 한 번 (§1.1 로 출주로 분류된 행만)."""

    race_date: date
    meet: str | None  # 정규화 라벨(서울·부경·제주), 모르면 None
    meet_label: str | None  # 원문(strip) — 정규화가 안 될 때 화면용
    race_no: int
    rank: int | None  # ≥ 1 이면 착순, None = 순위 없음
    time_tenths: int | None
    track_condition: str | None
    jockey_name: str | None
    trainer_name: str | None
    hr_rating: int | None
    budam_tenths: int | None
    chul_no: int | None
    distance: int | None
    field_size: int | None

    @property
    def is_win(self) -> bool:
        return self.rank == 1

    @property
    def is_top3(self) -> bool:
        return self.rank is not None and 1 <= self.rank <= 3


def to_start(row: HistoryRow, defn: RuleSetDef) -> Start | None:
    """이력 행 → Start. 미출주(착순·기록 모두 없음)면 None."""
    rank = parse.parse_pos_int(row.rank)
    time_tenths = parse.parse_time_tenths(row.record_time)
    if classify_start(rank, time_tenths) is None:
        return None
    return Start(
        race_date=row.race_date,
        meet=parse.normalize_meet(row.meet),
        meet_label=parse.norm_name(row.meet),
        race_no=int(row.race_no),
        rank=rank,
        time_tenths=time_tenths,
        track_condition=parse.norm_name(row.track_condition),
        jockey_name=parse.norm_name(row.jockey_name),
        trainer_name=parse.norm_name(row.trainer_name),
        hr_rating=parse.parse_rating(row.raw_hr_rating),
        budam_tenths=parse.parse_tenths(row.raw_wg_budam),
        chul_no=parse.parse_pos_int(row.raw_chul_no),
        distance=race_distance(row.distance, row.raw_rc_dist, defn),
        field_size=row.field_size if row.field_size and row.field_size > 0 else None,
    )


def starts_of(rows: Iterable[HistoryRow], defn: RuleSetDef) -> list[Start]:
    """출주만 남겨 오래된 → 최근 (race_date, race_no) 순."""
    out = [s for s in (to_start(r, defn) for r in rows) if s is not None]
    out.sort(key=lambda s: (s.race_date, s.race_no))
    return out


@dataclass(frozen=True)
class FormStats:
    """최근 성적 — [H − window_days, H) 출주 중 최근 last_n 전."""

    window_starts: int  # 창 안 출주 수 (자격 판정)
    used: tuple[Start, ...]  # 사용한 경주 (오래된 → 최근)
    top3: int
    wins: int
    last_rank: int | None  # 사용한 경주 중 가장 최근 경주 착순 (순위 없음 = None)
    rank_sum: int  # 착순 있는 경주만
    rank_n: int


@dataclass(frozen=True)
class CourseStats:
    """같은 경마장·같은 거리 통산 (< H)."""

    meet: str
    distance: int
    starts: int
    wins: int
    top3: int


@dataclass(frozen=True)
class BestTime:
    """같은 경마장·거리 최고기록 (같은 기록이면 먼저 낸 경주)."""

    time_tenths: int
    race_date: date
    track_condition: str | None


@dataclass(frozen=True)
class HorseFeatures:
    horse_no: str
    history_rows: int  # 이력 행 수 (미출주 포함) — live 커버리지 가드용
    starts: tuple[Start, ...]  # 출주 전체, 오래된 → 최근
    career_starts: int
    career_wins: int
    career_top3: int
    form: FormStats
    course: CourseStats | None  # 오늘 거리 모르면 None
    best_time: BestTime | None
    days_since_last: int | None  # D − 마지막 출주일
    last: Start | None
    rating_prev: int | None  # 가장 최근 출주의 hrRating
    max_rating: int | None  # 과거 hrRating 최댓값
    rated_starts: int  # hrRating 이 있는 출주 수
    distances: frozenset[int]  # 과거 출주 거리
    jockeys: frozenset[str]  # 과거에 이 말을 탄 기수 이름
    win_streak: int  # 최근 연속 1착 수

    @property
    def last5(self) -> tuple[Start, ...]:
        """최근 5전 (오래된 → 최근)."""
        return self.starts[-5:]


def compute_features(
    horse_no: str,
    rows: Sequence[HistoryRow],
    *,
    d: date,
    h: date,
    meet: str,
    distance: int | None,
    defn: RuleSetDef,
) -> HorseFeatures:
    """한 말의 이력 행(< h) → 특징. d = 경주일, meet·distance = 오늘 경주."""
    key = str(horse_no).strip()
    own = [r for r in rows if str(r.horse_no).strip() == key]
    assert_strictly_before(own, h)
    starts = tuple(starts_of(own, defn))

    # 최근 성적
    form_cfg = defn.p("rules", "form")
    lo = h - timedelta(days=int(form_cfg["window_days"]))
    window = [s for s in starts if lo <= s.race_date < h]
    used = tuple(window[-int(form_cfg["last_n"]) :]) if window else ()
    ranked = [s.rank for s in used if s.rank is not None]
    form = FormStats(
        window_starts=len(window),
        used=used,
        top3=sum(1 for s in used if s.is_top3),
        wins=sum(1 for s in used if s.is_win),
        last_rank=used[-1].rank if used else None,
        rank_sum=sum(ranked),
        rank_n=len(ranked),
    )

    # 거리 적성 · 최고기록 (오늘 경마장·거리)
    course: CourseStats | None = None
    best: BestTime | None = None
    if distance is not None:
        same = [s for s in starts if s.meet == meet and s.distance == distance]
        course = CourseStats(
            meet=meet,
            distance=distance,
            starts=len(same),
            wins=sum(1 for s in same if s.is_win),
            top3=sum(1 for s in same if s.is_top3),
        )
        timed = [s for s in same if s.time_tenths is not None]
        if timed:
            b = min(timed, key=lambda s: (s.time_tenths, s.race_date, s.race_no))
            assert b.time_tenths is not None
            best = BestTime(b.time_tenths, b.race_date, b.track_condition)

    last = starts[-1] if starts else None
    rated = [s.hr_rating for s in starts if s.hr_rating is not None]
    streak = 0
    for s in reversed(starts):
        if not s.is_win:
            break
        streak += 1

    return HorseFeatures(
        horse_no=key,
        history_rows=len(own),
        starts=starts,
        career_starts=len(starts),
        career_wins=sum(1 for s in starts if s.is_win),
        career_top3=sum(1 for s in starts if s.is_top3),
        form=form,
        course=course,
        best_time=best,
        days_since_last=(d - last.race_date).days if last else None,
        last=last,
        rating_prev=last.hr_rating if last else None,
        max_rating=max(rated) if rated else None,
        rated_starts=len(rated),
        distances=frozenset(s.distance for s in starts if s.distance is not None),
        jockeys=frozenset(s.jockey_name for s in starts if s.jockey_name),
        win_streak=streak,
    )


@dataclass(frozen=True)
class Entrant:
    """기준 계산 단위 = 출전마 + 특징."""

    runner: Runner
    feat: HorseFeatures
