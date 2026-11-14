"""경마지 단위 테스트 공용 — 메모리 FakeProvider + 시나리오 빌더 (DB 없음).

FakeProvider 는 계약 §1 의 SQL 의미를 Python 으로 흉내 낸다:
- history: race_date < h 만 (as-of), field_size = 같은 경주 결과 행 수,
  거리 = races 메타(LEFT JOIN).
- jockey_stats / trainer_stats: btrim 이름, meet 일치, [h − window, h) 출주(§1.1) 수·1착·3착 이내,
  distinct_ids = 같은 meet·race_date < h 전체의 정규화 jkNo 개수 (NULL 제외).
  `set_jockey_stat` 로 직접 넣은 값이 있으면 그 값을 쓴다 (기준 conformance 용).
- entries: batch_at = 같은 (D, meet) 의 MAX(updated_at).
- calls: 호출 기록 (backtest 에서 Q4·Q5 를 부르지 않는지 등 확인용).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from src.racing_form import features, parse
from src.racing_form.definitions import RuleSetDef
from src.racing_form.features import Entrant
from src.racing_form.types import (
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

KST = ZoneInfo("Asia/Seoul")


def kst(y: int, m: int, d: int, hh: int = 0, mi: int = 0, ss: int = 0) -> datetime:
    return datetime(y, m, d, hh, mi, ss, tzinfo=KST)


@dataclass
class FakeResult:
    """race_results 한 행 (raw 값은 텍스트)."""

    race_date: date
    meet: str | None
    race_no: int
    horse_no: str
    rank: int | None
    record_time: str | None = "72.0"
    track_condition: str | None = "양호"
    jockey_name: str | None = None
    trainer_name: str | None = None
    jk_no: str | None = None
    hr_rating: str | None = None
    wg_budam: str | None = None
    chul_no: str | None = None
    rc_dist: str | None = None
    field_size: int | None = None  # None 이면 같은 경주 결과 행 수


class FakeProvider:
    """types.Provider 의 메모리 구현."""

    def __init__(self, *, entries_updated_at: datetime | None = None) -> None:
        self.metas: dict[tuple[date, str], dict[int, RaceMeta]] = defaultdict(dict)
        self.entry_rows: list[EntryRow] = []
        self.result_rows: list[FakeResult] = []
        self.rank_change_rows: list[RankChange] = []
        self.master_rows: dict[str, MasterRow] = {}
        self.dividend_rows: list[tuple[date, str, DividendRow]] = []
        self.jockey_overrides: dict[tuple[str, str], ConnStat] = {}
        self.trainer_overrides: dict[tuple[str, str], ConnStat] = {}
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.default_updated_at = entries_updated_at or kst(2026, 11, 14, 15, 0)

    # ------------------------------------------------------------------ 빌더
    def add_race(
        self,
        d: date,
        meet: str,
        race_no: int,
        *,
        distance: int | None = 1200,
        raw_rc_dist: str | None = None,
        race_name: str | None = None,
        grade: str | None = "국6",
        track_type: str | None = "더트",
        start_time: str | None = None,
        plan_name: str | None = None,
        plan_grade: str | None = None,
    ) -> RaceMeta:
        meta = RaceMeta(
            race_no=race_no,
            race_name=race_name,
            distance=distance,
            raw_rc_dist=raw_rc_dist,
            grade=grade,
            track_type=track_type,
            start_time=start_time,
            plan_name=plan_name,
            plan_grade=plan_grade,
        )
        self.metas[(d, meet)][race_no] = meta
        return meta

    def add_entry(
        self,
        d: date,
        meet: str,
        race_no: int,
        horse_no: str,
        chul_no: int | None,
        *,
        horse_name: str | None = None,
        jockey: str | None = None,
        trainer: str | None = None,
        rating: int | None = None,
        raw_hr_rating: str | None = None,
        wg_budam: str | None = "54.0",
        age: str | None = "4",
        sex: str | None = "수",
        updated_at: datetime | None = None,
        jc_before: str | None = None,
        jc_after: str | None = None,
        jc_reason: str | None = None,
        jc_weight_before: str | None = None,
        jc_weight_after: str | None = None,
    ) -> EntryRow:
        ts = updated_at or self.default_updated_at
        row = EntryRow(
            race_date=d,
            meet=meet,
            race_no=race_no,
            horse_no=horse_no,
            chul_no=chul_no,
            horse_name=horse_name if horse_name is not None else f"말{horse_no}",
            jockey_name=jockey,
            trainer_name=trainer,
            age=age,
            sex=sex,
            rating=rating,
            raw_hr_rating=raw_hr_rating,
            raw_wg_budam=wg_budam,
            updated_at=ts,
            batch_at=ts,
            jc_before=jc_before,
            jc_after=jc_after,
            jc_reason=jc_reason,
            jc_weight_before=jc_weight_before,
            jc_weight_after=jc_weight_after,
        )
        self.entry_rows.append(row)
        return row

    def add_result(
        self,
        d: date,
        meet: str | None,
        race_no: int,
        horse_no: str,
        rank: int | None,
        *,
        time: str | None = "72.0",
        chul_no: int | str | None = None,
        jockey: str | None = None,
        jk_no: str | None = None,
        trainer: str | None = None,
        hr_rating: str | int | None = None,
        wg_budam: str | None = None,
        track: str | None = "양호",
        distance: int | None = None,
        field_size: int | None = None,
    ) -> FakeResult:
        row = FakeResult(
            race_date=d,
            meet=meet,
            race_no=race_no,
            horse_no=horse_no,
            rank=rank,
            record_time=time,
            track_condition=track,
            jockey_name=jockey,
            trainer_name=trainer,
            jk_no=jk_no,
            hr_rating=None if hr_rating is None else str(hr_rating),
            wg_budam=wg_budam,
            chul_no=None if chul_no is None else str(chul_no),
            rc_dist=None if distance is None else str(distance),
            field_size=field_size,
        )
        self.result_rows.append(row)
        return row

    def add_rank_change(
        self, horse_no: str, st_date: date, before: str | None, after: str | None
    ) -> None:
        self.rank_change_rows.append(RankChange(horse_no, st_date, before, after))

    def set_master(self, horse_no: str, total: int | None) -> None:
        self.master_rows[horse_no] = MasterRow(horse_no, total)

    def add_dividend(
        self, d: date, meet: str, race_no: int, chul_no_text: str, win_rate: str | None
    ) -> None:
        self.dividend_rows.append((d, meet, DividendRow(race_no, chul_no_text, win_rate)))

    def set_jockey_stat(
        self, name: str, meet: str, starts: int, wins: int, top3: int, ids: int = 1
    ) -> None:
        self.jockey_overrides[(name, meet)] = ConnStat(name, starts, wins, top3, ids)

    def set_trainer_stat(self, name: str, meet: str, starts: int, wins: int, top3: int) -> None:
        self.trainer_overrides[(name, meet)] = ConnStat(name, starts, wins, top3, 0)

    # ------------------------------------------------------------------ Provider
    def _call(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))

    def called(self, name: str) -> bool:
        return any(c[0] == name for c in self.calls)

    def calendar(self, d_from: date, d_to: date, meets: tuple[str, ...]) -> list[CalendarRow]:
        self._call("calendar", d_from, d_to, meets)
        out: list[CalendarRow] = []
        for (d, meet), races in sorted(self.metas.items()):
            if not (d_from <= d <= d_to and meet in meets):
                continue
            with_entries = sorted(
                {e.race_no for e in self.entry_rows if e.race_date == d and e.meet == meet}
                & set(races)
            )
            if not with_entries:
                continue
            posts = [
                (races[n].start_time or "").strip()
                for n in with_entries
                if (races[n].start_time or "").strip()
            ]
            out.append(CalendarRow(d, meet, len(with_entries), min(posts) if posts else None))
        return out

    def entries(self, d: date, meet: str) -> list[EntryRow]:
        self._call("entries", d, meet)
        rows = [e for e in self.entry_rows if e.race_date == d and e.meet == meet]
        if not rows:
            return []
        batch = max(e.updated_at for e in rows)
        return [replace(e, batch_at=batch) for e in rows]

    def race_meta(self, d: date, meet: str) -> list[RaceMeta]:
        self._call("race_meta", d, meet)
        return [self.metas[(d, meet)][n] for n in sorted(self.metas.get((d, meet), {}))]

    def _field_size(self, r: FakeResult) -> int:
        if r.field_size is not None:
            return r.field_size
        return sum(
            1
            for x in self.result_rows
            if (x.race_date, x.meet, x.race_no) == (r.race_date, r.meet, r.race_no)
        )

    def history(self, horse_nos: list[str], h: date) -> list[HistoryRow]:
        self._call("history", tuple(horse_nos), h)
        wanted = set(horse_nos)
        out: list[HistoryRow] = []
        for r in self.result_rows:
            if r.horse_no not in wanted or r.race_date >= h:
                continue
            meta = self.metas.get((r.race_date, r.meet or ""), {}).get(r.race_no)
            out.append(
                HistoryRow(
                    horse_no=r.horse_no,
                    race_date=r.race_date,
                    meet=r.meet,
                    race_no=r.race_no,
                    rank=r.rank,
                    record_time=r.record_time,
                    track_condition=r.track_condition,
                    jockey_name=r.jockey_name,
                    trainer_name=r.trainer_name,
                    raw_jk_no=r.jk_no,
                    raw_hr_rating=r.hr_rating,
                    raw_wg_budam=r.wg_budam,
                    raw_chul_no=r.chul_no,
                    distance=meta.distance if meta is not None else None,
                    raw_rc_dist=r.rc_dist,
                    field_size=self._field_size(r),
                )
            )
        return out

    def _conn_stats(
        self,
        names: list[str],
        meet: str,
        h: date,
        window_days: int,
        *,
        attr: str,
        overrides: dict[tuple[str, str], ConnStat],
        with_ids: bool,
    ) -> list[ConnStat]:
        lo = h - timedelta(days=window_days)
        out: list[ConnStat] = []
        for name in names:
            if (name, meet) in overrides:
                out.append(overrides[(name, meet)])
                continue
            mine = [
                r
                for r in self.result_rows
                if parse.norm_name(getattr(r, attr)) == name
                and parse.normalize_meet(r.meet) == meet
                and r.race_date < h
            ]
            window = [
                r
                for r in mine
                if lo <= r.race_date
                and features.classify_start(
                    parse.parse_pos_int(r.rank), parse.parse_time_tenths(r.record_time)
                )
                is not None
            ]
            if not window:
                continue
            ranks = [parse.parse_pos_int(r.rank) for r in window]
            out.append(
                ConnStat(
                    name=name,
                    starts=len(window),
                    wins=sum(1 for k in ranks if k == 1),
                    top3=sum(1 for k in ranks if k is not None and k <= 3),
                    distinct_ids=parse.distinct_jk_ids(r.jk_no for r in mine) if with_ids else 0,
                )
            )
        return out

    def jockey_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        self._call("jockey_stats", tuple(names), meet, h, window_days)
        return self._conn_stats(
            names,
            meet,
            h,
            window_days,
            attr="jockey_name",
            overrides=self.jockey_overrides,
            with_ids=True,
        )

    def trainer_stats(
        self, names: list[str], meet: str, h: date, window_days: int
    ) -> list[ConnStat]:
        self._call("trainer_stats", tuple(names), meet, h, window_days)
        return self._conn_stats(
            names,
            meet,
            h,
            window_days,
            attr="trainer_name",
            overrides=self.trainer_overrides,
            with_ids=False,
        )

    def rank_changes(self, horse_nos: list[str], d: date) -> list[RankChange]:
        self._call("rank_changes", tuple(horse_nos), d)
        latest: dict[str, RankChange] = {}
        for r in self.rank_change_rows:
            if r.horse_no in horse_nos and r.st_date <= d:
                cur = latest.get(r.horse_no)
                if cur is None or r.st_date > cur.st_date:
                    latest[r.horse_no] = r
        return [latest[k] for k in sorted(latest)]

    def masters(self, horse_nos: list[str]) -> list[MasterRow]:
        self._call("masters", tuple(horse_nos))
        return [self.master_rows[h] for h in horse_nos if h in self.master_rows]

    def results_through(self, h: date) -> date | None:
        self._call("results_through", h)
        dates = [r.race_date for r in self.result_rows if r.race_date < h]
        return max(dates) if dates else None

    def results_exist(self, d: date, meet: str) -> bool:
        self._call("results_exist", d, meet)
        return any(r.race_date == d and r.meet == meet for r in self.result_rows)

    def unresolved_races(self, h: date, days: int) -> list[tuple[date, str]]:
        self._call("unresolved_races", h, days)
        lo = h - timedelta(days=days)
        done = {(r.race_date, r.meet, r.race_no) for r in self.result_rows}
        out = {
            (d, meet)
            for (d, meet), races in self.metas.items()
            if lo <= d < h
            for n in races
            if (d, meet, n) not in done
        }
        return sorted(out)

    def results(self, d: date, meet: str) -> list[ResultRow]:
        self._call("results", d, meet)
        return [
            ResultRow(r.race_no, r.horse_no, r.rank, r.record_time, r.chul_no)
            for r in self.result_rows
            if r.race_date == d and r.meet == meet
        ]

    def win_dividends(self, d: date, meet: str) -> list[DividendRow]:
        self._call("win_dividends", d, meet)
        return [row for dd, m, row in self.dividend_rows if dd == d and m == meet]


# ---------------------------------------------------------------------------
# 순수 모듈 단위 테스트용 생성기 (provider 없이 Entrant 만들기)
# ---------------------------------------------------------------------------


def hist_row(
    horse_no: str,
    race_date: date,
    rank: int | None,
    *,
    meet: str | None = "서울",
    race_no: int = 1,
    time: str | None = "72.0",
    distance: int | None = 1200,
    jockey: str | None = None,
    trainer: str | None = None,
    hr_rating: str | int | None = None,
    wg_budam: str | None = None,
    jk_no: str | None = None,
    chul_no: str | None = None,
    track: str | None = "양호",
    field_size: int | None = 10,
) -> HistoryRow:
    return HistoryRow(
        horse_no=horse_no,
        race_date=race_date,
        meet=meet,
        race_no=race_no,
        rank=rank,
        record_time=time,
        track_condition=track,
        jockey_name=jockey,
        trainer_name=trainer,
        raw_jk_no=jk_no,
        raw_hr_rating=None if hr_rating is None else str(hr_rating),
        raw_wg_budam=wg_budam,
        raw_chul_no=chul_no,
        distance=distance,
        raw_rc_dist=None,
        field_size=field_size,
    )


def entry_row(
    race_no: int,
    horse_no: str,
    chul_no: int | None,
    *,
    d: date = date(2026, 11, 15),
    meet: str = "서울",
    rating: int | None = None,
    raw_hr_rating: str | None = None,
    jockey: str | None = None,
    trainer: str | None = None,
    wg_budam: str | None = "54.0",
    updated_at: datetime | None = None,
    batch_at: datetime | None = None,
    **jc: str | None,
) -> EntryRow:
    ts = updated_at or kst(2026, 11, 14, 15, 0)
    return EntryRow(
        race_date=d,
        meet=meet,
        race_no=race_no,
        horse_no=horse_no,
        chul_no=chul_no,
        horse_name=f"말{horse_no}",
        jockey_name=jockey,
        trainer_name=trainer,
        age="4",
        sex="수",
        rating=rating,
        raw_hr_rating=raw_hr_rating,
        raw_wg_budam=wg_budam,
        updated_at=ts,
        batch_at=batch_at or ts,
        **jc,  # type: ignore[arg-type]
    )


def make_entrant(
    chul_no: int,
    defn: RuleSetDef,
    *,
    race_no: int = 1,
    horse_no: str | None = None,
    rating: int | None = None,
    history: list[HistoryRow] | None = None,
    jockey: str | None = None,
    trainer: str | None = None,
    wg_budam: str | None = "54.0",
    d: date = date(2026, 11, 15),
    meet: str = "서울",
    distance: int | None = 1200,
    **jc: str | None,
) -> Entrant:
    """EntryRow → Runner → compute_features 로 실제 경로를 거친 Entrant."""
    hn = horse_no or f"H{race_no:02d}{chul_no:02d}"
    h = d - timedelta(days=int(defn.p("history", "offset_days")))
    row = entry_row(
        race_no,
        hn,
        chul_no,
        d=d,
        meet=meet,
        rating=rating,
        jockey=jockey,
        trainer=trainer,
        wg_budam=wg_budam,
        **jc,
    )
    runner = features.to_runner(row)
    rows = [replace(r, horse_no=hn) for r in (history or [])]
    feat = features.compute_features(hn, rows, d=d, h=h, meet=meet, distance=distance, defn=defn)
    return Entrant(runner, feat)


# ---------------------------------------------------------------------------
# payload 골든 시나리오 (payload_v1.golden.json)
# ---------------------------------------------------------------------------

GOLDEN_D = date(2026, 11, 15)  # 일요일
GOLDEN_MEET = "서울"
GOLDEN_NOW = kst(2026, 11, 14, 18, 0)


def payload_scenario() -> FakeProvider:
    """3경주 — 1R 보통(모든 기준·주목마), 2R 대상경주(기수 교체·데뷔·휴양 복귀·등급 변동·
    기록 없음), 3R 4두(small_field). 결정적."""
    d, meet = GOLDEN_D, GOLDEN_MEET
    h = d - timedelta(days=1)
    p = FakeProvider(entries_updated_at=kst(2026, 11, 14, 15, 0))

    def ago(n: int) -> date:
        return h - timedelta(days=n)

    # ---------------- 1R 1200m 국6 6두
    p.add_race(d, meet, 1, distance=1200, grade="국6", start_time="10:35")
    r1 = [
        # chul, horse, rating, jockey, trainer
        (1, "0041001", 72, "김가람", "박조교"),
        (2, "0041002", 68, "이나래", "최조교"),
        (3, "0041003", 75, "박다온", "박조교"),
        (4, "0041004", 61, "최라온", "정조교"),
        (5, "0041005", 66, "정마루", "최조교"),
        (6, "0041006", None, "한바다", "정조교"),
    ]
    for chul, hn, rating, jk, tr in r1:
        p.add_entry(
            d, meet, 1, hn, chul, horse_name=f"골든{chul}", jockey=jk, trainer=tr, rating=rating
        )
        p.set_master(hn, 8)
    # 출전취소마 잔존(stale) — 배치(15:00)보다 3시간 오래된 행 → 제외 (1/7 이라 경고 없음)
    p.add_entry(d, meet, 1, "0041099", 7, rating=90, updated_at=kst(2026, 11, 14, 12, 0))
    # 이력 창 안 미해결 경주 (races 는 있는데 결과 없음) → 경고 unresolved_history
    p.add_race(date(2026, 11, 9), meet, 9, distance=1200)
    # 최근 성적 (1년 안, 1400m — 거리 적성과 섞이지 않게)
    form = {
        "0041001": [3, 1, 2],
        "0041002": [5, 4, 6],
        "0041003": [2, 2, 1],
        "0041004": [7, 3],
        "0041005": [1, 8, 9],
        "0041006": [4],
    }
    for hn, ranks in form.items():
        for i, rk in enumerate(ranks):
            n = len(ranks) - i
            p.add_result(
                ago(14 * n),
                meet,
                3,
                hn,
                rk,
                distance=1400,
                time=f"{85 + rk}.4",
                hr_rating=60 + i,
                wg_budam="54.0",
                jockey="김가람" if hn == "0041001" else None,
                trainer={"0041001": "박조교", "0041003": "박조교"}.get(hn, "최조교"),
                field_size=10,
            )
    # 거리 적성 (서울 1200m, 1년보다 전)
    course = {
        "0041001": [1, 4, 2],
        "0041002": [6, 7, 5],
        "0041003": [1, 1, 3, 2],
        "0041004": [2, 5, 9],
        "0041005": [3, 3],
    }
    for hn, ranks in course.items():
        for i, rk in enumerate(ranks):
            p.add_result(
                ago(400 + 21 * (len(ranks) - i)),
                meet,
                5,
                hn,
                rk,
                distance=1200,
                time=f"{72 + rk}.{i}",
                track="건조" if i % 2 else "양호",
                field_size=9,
            )
    for name, st in {
        "김가람": (40, 8, 15),
        "이나래": (30, 3, 9),
        "박다온": (25, 6, 11),
        "최라온": (22, 2, 5),
        "정마루": (35, 5, 12),
    }.items():
        p.set_jockey_stat(name, meet, *st)

    # ---------------- 2R 대상경주 1400m (L)
    p.add_race(
        d, meet, 2, distance=1400, grade="L", race_name="서울마주협회장배", start_time="11:10"
    )
    # 기수 교체 + 부담 변화
    p.add_entry(
        d,
        meet,
        2,
        "0042001",
        1,
        horse_name="바람개비",
        jockey="오누리",
        trainer="윤조교",
        rating=80,
        wg_budam="55.0",
        jc_before="오누리",
        jc_after="서다솜",
        jc_reason="기수 부상",
        jc_weight_before="55.0",
        jc_weight_after="54.0",
    )
    p.set_master("0042001", 12)
    for i, rk in enumerate([2, 1, 1]):
        p.add_result(
            ago(21 * (3 - i)),
            meet,
            4,
            "0042001",
            rk,
            distance=1400,
            time="86.1",
            jockey="오누리",
            trainer="윤조교",
            hr_rating=74 + i,
            wg_budam="56.0",
        )
    # 데뷔 (이력 0, 마스터 0)
    p.add_entry(d, meet, 2, "0042002", 2, horse_name="새싹", jockey="장한결", rating=None)
    p.set_master("0042002", 0)
    # 휴양 복귀 200일 + 등급 변동 (국5 → 국6 강급, 마지막 출주 뒤)
    p.add_entry(
        d,
        meet,
        2,
        "0042003",
        3,
        horse_name="먼길",
        jockey="임새벽",
        trainer="윤조교",
        rating=70,
        wg_budam="53.0",
    )
    p.set_master("0042003", 20)
    p.add_result(
        ago(220),
        "부경",
        6,
        "0042003",
        2,
        distance=1200,
        time="73.5",
        jockey="임새벽",
        trainer="강조교",
        hr_rating=72,
        wg_budam="55.0",
    )
    p.add_result(
        ago(200),
        "부경",
        7,
        "0042003",
        3,
        distance=1400,
        time="86.9",
        jockey="임새벽",
        trainer="강조교",
        hr_rating=71,
        wg_budam="56.0",
    )
    p.add_rank_change("0042003", ago(30), "국5등급", "국6등급")
    # 기록 없음 (이력 0, 마스터 > 0)
    p.add_entry(d, meet, 2, "0042004", 4, horse_name="이방인", jockey="윤소리", rating=65)
    p.set_master("0042004", 5)
    # 짧은 간격 + 3연승
    p.add_entry(
        d,
        meet,
        2,
        "0042005",
        5,
        horse_name="연승호",
        jockey="송이랑",
        trainer="윤조교",
        rating=78,
    )
    p.set_master("0042005", 6)
    for i, n in enumerate([30, 20, 10]):
        p.add_result(
            ago(n),
            meet,
            2 + i,
            "0042005",
            1,
            distance=1400,
            time="85.0",
            jockey="송이랑",
            trainer="윤조교",
            hr_rating=70 + 2 * i,
        )

    # ---------------- 3R 1000m 4두 (small_field)
    p.add_race(d, meet, 3, distance=1000, grade="국6", start_time="11:40")
    for chul in range(1, 5):
        hn = f"004300{chul}"
        p.add_entry(d, meet, 3, hn, chul, horse_name=f"소수{chul}", jockey=None, rating=50 + chul)
        p.set_master(hn, 0)
    return p
