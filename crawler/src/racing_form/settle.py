"""경주별 정산 분류 (계약 §6) + 표시 판정 (§6.1). 순수 함수 — DB·현재 시각을 읽지 않는다.

- status: "pending"(행을 쓰지 않음) | "official" | "race_void".
  결과 행 0 → (KST 오늘 ≥ D+7 이면 race_void, 아니면 pending) ·
  결과 행 < 발행 명단의 50% → pending ·
  결과 행 전부 rank NULL/0 → (now ≥ D+1 12:30 이면 race_void, 아니면 pending) · 그 밖 official.
- 결과 행이 있으면 rank·기록과 무관하게 순위 밖 = 빗나감 (주행중지·낙마·실격 포함).
  결과 행이 없는 발행 명단 말 = non_starters → 그 말의 표시는 무효.
- 배당 테이블 race_dividends.horse_no 에는 **출전번호(chulNo)** 가 들어 있다 → 결과 행의
  raw chulNo(정수)로 horse_no 를 찾고, 없으면 발행본 runners 의 chul_no 로 찾는다.
- results_digest = sha256(정렬 JSON {finish, favorites, status}) — 입력 행 순서와 무관.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from . import parse, schedule
from .definitions import RuleSetDef
from .types import DividendRow, ResultRow

PENDING = "pending"
OFFICIAL = "official"
RACE_VOID = "race_void"


@dataclass(frozen=True)
class Outcome:
    """경주 하나의 정산 (racing_form_race_outcomes 의 값 컬럼). status=pending 이면 저장하지 않는다.

    finish: [{horse_no, chul_no, rank, time_tenths}] — rank 있는 행이 먼저(rank → chul_no),
    rank NULL 은 뒤(chul_no 순). winners·placed·extra_starters 는 finish 순서, non_starters 는
    발행 명단(출전번호) 순서, favorites 는 출전번호 순. pop_ranks: {horse_no: 인기 순위}.
    """

    race_no: int
    status: str
    starters: int
    finish: list[dict[str, Any]] = field(default_factory=list)
    winners: list[str] = field(default_factory=list)
    placed: list[str] = field(default_factory=list)
    non_starters: list[str] = field(default_factory=list)
    extra_starters: list[str] = field(default_factory=list)
    favorites: list[str] = field(default_factory=list)
    pop_ranks: dict[str, int] = field(default_factory=dict)
    results_digest: str = ""

    def to_row(self) -> dict[str, Any]:
        """racing_form_race_outcomes 값 컬럼 (edition_id·race_date·시각·is_final 은 저장 쪽)."""
        return {
            "race_no": self.race_no,
            "status": self.status,
            "starters": self.starters,
            "finish": self.finish,
            "winners": self.winners,
            "placed": self.placed,
            "non_starters": self.non_starters,
            "extra_starters": self.extra_starters,
            "favorites": self.favorites,
            "pop_ranks": self.pop_ranks,
            "results_digest": self.results_digest,
        }


def results_digest(
    finish: Sequence[Mapping[str, Any]], favorites: Sequence[str], status: str
) -> str:
    body = json.dumps(
        {"finish": list(finish), "favorites": list(favorites), "status": status},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _rank(value: int | None) -> int | None:
    """rank NULL/0 → None (착순 없음)."""
    return parse.parse_pos_int(value)


def _finish_key(item: Mapping[str, Any]) -> tuple[int, int, int, str]:
    rank = item["rank"]
    chul = item["chul_no"]
    return (
        0 if rank is not None else 1,
        rank if rank is not None else 0,
        chul if chul is not None else 10**6,
        item["horse_no"],
    )


def _parse_rate(value: str | None) -> Decimal | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        dec = Decimal(s)
    except ArithmeticError:
        return None
    return dec if dec.is_finite() and dec > 0 else None


def settle_race(
    race: Mapping[str, Any],
    results: Sequence[ResultRow],
    dividends: Sequence[DividendRow],
    now: datetime,
    d: date,
    defn: RuleSetDef,
) -> Outcome:
    """발행본 races[] 의 경주 하나 + (D, meet) 결과·단승 배당 → Outcome.

    results·dividends 는 그날 전 경주 것을 넘겨도 된다 (race_no 로 거른다).
    """
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    race_no = int(race["race_no"])
    published = [(str(r["horse_no"]), int(r["chul_no"])) for r in race["runners"]]
    published_set = {h for h, _ in published}
    rows = [r for r in results if int(r.race_no) == race_no]

    # 결과 행 → finish
    finish: list[dict[str, Any]] = []
    chul_to_horse: dict[int, str] = {}
    for r in rows:
        horse_no = str(r.horse_no).strip()
        chul = parse.parse_pos_int(r.raw_chul_no)
        if chul is not None and chul not in chul_to_horse:
            chul_to_horse[chul] = horse_no
        finish.append(
            {
                "horse_no": horse_no,
                "chul_no": chul,
                "rank": _rank(r.rank),
                "time_tenths": parse.parse_time_tenths(r.record_time),
            }
        )
    finish.sort(key=_finish_key)
    for horse_no, chul in published:
        chul_to_horse.setdefault(chul, horse_no)

    result_set = {f["horse_no"] for f in finish}
    winners = [f["horse_no"] for f in finish if f["rank"] == 1]
    placed = [f["horse_no"] for f in finish if f["rank"] is not None and f["rank"] <= 3]
    non_starters = [h for h, _ in published if h not in result_set]
    extra = [f["horse_no"] for f in finish if f["horse_no"] not in published_set]

    # 단승 배당 → 1번 인기·인기 순위 (출전번호 → horse_no)
    rates: dict[str, Decimal] = {}
    for dv in dividends:
        if int(dv.race_no) != race_no:
            continue
        chul = parse.parse_pos_int(dv.chul_no_text)
        rate = _parse_rate(dv.win_rate)
        if chul is None or rate is None or chul not in chul_to_horse:
            continue
        horse_no = chul_to_horse[chul]
        if horse_no not in rates or rate < rates[horse_no]:
            rates[horse_no] = rate
    chul_of = {h: c for c, h in chul_to_horse.items()}
    favorites: list[str] = []
    pop_ranks: dict[str, int] = {}
    if rates:
        low = min(rates.values())
        favorites = sorted(
            (h for h, v in rates.items() if v == low), key=lambda h: (chul_of.get(h, 10**6), h)
        )
        for h, v in rates.items():
            pop_ranks[h] = 1 + sum(1 for other in rates.values() if other < v)
        pop_ranks = dict(sorted(pop_ranks.items(), key=lambda kv: (kv[1], chul_of.get(kv[0], 0))))

    # 상태
    if not rows:
        status = RACE_VOID if schedule.kst_today(now) >= schedule.void_after(d, defn) else PENDING
    elif len(rows) * 100 < int(defn.p("settle", "pending_below_pct")) * len(published):
        status = PENDING
    elif all(f["rank"] is None for f in finish):
        status = RACE_VOID if now >= schedule.race_void_all_null_after(d, defn) else PENDING
    else:
        status = OFFICIAL

    return Outcome(
        race_no=race_no,
        status=status,
        starters=len(rows),
        finish=finish,
        winners=winners,
        placed=placed,
        non_starters=non_starters,
        extra_starters=extra,
        favorites=favorites,
        pop_ranks=pop_ranks,
        results_digest=results_digest(finish, favorites, status),
    )


def _get(outcome: Outcome | Mapping[str, Any], key: str) -> Any:
    if isinstance(outcome, Mapping):
        return outcome.get(key)
    return getattr(outcome, key)


def pick_outcome(horse_no: str, outcome: Outcome | Mapping[str, Any] | None) -> str:
    """표시 판정 (§6.1): pending · void · win · top3 · miss.

    outcome 은 Outcome 또는 racing_form_race_outcomes 행(dict). 행이 없으면(None) pending.
    """
    if outcome is None:
        return PENDING
    status = _get(outcome, "status")
    if status == PENDING:
        return PENDING
    if status == RACE_VOID or horse_no in (_get(outcome, "non_starters") or ()):
        return "void"
    if horse_no in (_get(outcome, "winners") or ()):
        return "win"
    if horse_no in (_get(outcome, "placed") or ()):
        return "top3"
    return "miss"
