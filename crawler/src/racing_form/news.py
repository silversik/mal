"""말 소식 — 발행 시점 KRA 데이터 이벤트 (계약 §3). 순수 함수.

- 배지: 말마다 `news.badge_priority` 순 **전체** 목록을 payload 에 담는다. 화면이 앞
  `news.max_badges`(3) 개 + `<details>` 로 나눈다 (`split_badges`).
- 헤드라인: 호 전체에서 `news.headline_priority` 순(같은 종류 안에서는 경주·출전번호 순),
  최대 `news.max_headlines`(6) 개 + 넘친 수 `headline_overflow`. 180일 이상 복귀는 최대 2개
  (그 이상은 헤드라인 후보가 아니라 overflow 에도 세지 않는다).
- 문장은 사실·숫자·"11월 1일" 날짜만. 평가어 금지 (wording 템플릿 + 금지어 테스트).
- 헤드라인 text 는 배지 문장과 같다. 경주·출전번호·마명은 웹이 race_no·chul_no·horse_no 로 붙인다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from . import parse, wording
from .definitions import RuleSetDef
from .features import Entrant
from .types import MasterRow, RaceMeta, RankChange


@dataclass(frozen=True)
class Badge:
    kind: str
    text: str
    delta: int | None = None  # rating_change(정수, 부호 포함) · budam_change(0.1kg, 부호 포함)

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {"kind": self.kind, "text": self.text}
        if self.delta is not None:
            out["delta"] = self.delta
        return out


@dataclass(frozen=True)
class Headline:
    kind: str
    race_no: int | None
    chul_no: int | None
    horse_no: str | None
    text: str

    def to_json(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "race_no": self.race_no,
            "chul_no": self.chul_no,
            "horse_no": self.horse_no,
            "text": self.text,
        }


# ---------------------------------------------------------------------------
# 대상경주 (웹 isStakesRace 와 같은 판정 + race_plans)
# ---------------------------------------------------------------------------


def is_stakes_race(grade: str | None, race_name: str | None, plan_name: str | None = None) -> bool:
    """grade 에 'G'·'L'·'대상', 또는 race_name 에 '대상' (웹 isStakesRace), 또는 race_plans 매칭."""
    g = grade or ""
    n = race_name or ""
    if "G" in g or "L" in g or "대상" in g or "대상" in n:
        return True
    return parse.norm_name(plan_name) is not None


def stakes_info(meta: RaceMeta | None) -> dict[str, Any] | None:
    """RaceV1.stakes = {name, grade} | None. 이름은 races.race_name → race_plans 이름,
    등급은 race_plans 등급 → races.grade."""
    if meta is None or not is_stakes_race(meta.grade, meta.race_name, meta.plan_name):
        return None
    name = parse.norm_name(meta.race_name) or parse.norm_name(meta.plan_name) or ""
    grade = parse.norm_name(meta.plan_grade) or parse.norm_name(meta.grade)
    return {"name": name, "grade": grade}


def stakes_text(
    race_no: int, stakes: Mapping[str, Any], distance: int | None, defn: RuleSetDef
) -> str:
    name = str(stakes.get("name") or "")
    grade = stakes.get("grade")
    if distance is None:
        # 거리를 모르면 템플릿의 "{distance}m" 를 채울 수 없다 — 이름·등급만.
        return f"{race_no}R {name}" + (f" ({grade})" if grade else "")
    if grade:
        return wording.render(
            defn, "news_stakes", race_no=race_no, name=name, grade=grade, distance=distance
        )
    return wording.render(
        defn, "news_stakes_no_grade", race_no=race_no, name=name, distance=distance
    )


# ---------------------------------------------------------------------------
# 말 배지
# ---------------------------------------------------------------------------


def latest_rank_change(rows: Sequence[RankChange], horse_no: str, d: date) -> RankChange | None:
    """말별 st_date ≤ d 최신 1건 (provider 가 이미 1건으로 줄였어도 다시 고른다)."""
    cands = [r for r in rows if str(r.horse_no).strip() == horse_no and r.st_date <= d]
    return max(cands, key=lambda r: r.st_date) if cands else None


def class_direction(before: str | None, after: str | None) -> str:
    """after 숫자 > before 숫자 → class_down(강급), < → class_up(승급), 그 밖 class_other."""
    b = parse.normalize_class_label(before)
    a = parse.normalize_class_label(after)
    if a is None or b is None or a[1] == b[1]:
        return "class_other"
    return "class_down" if a[1] > b[1] else "class_up"


def _priority(defn: RuleSetDef) -> dict[str, int]:
    return {k: i for i, k in enumerate(defn.p("news", "badge_priority"))}


def sort_badges(badges: Sequence[Badge], defn: RuleSetDef) -> list[Badge]:
    """우선순위 순 (목록에 없는 kind 는 뒤, 같은 순위 안에서는 kind 이름순)."""
    pri = _priority(defn)
    return sorted(badges, key=lambda b: (pri.get(b.kind, len(pri)), b.kind))


def split_badges(badges: Sequence[Badge], defn: RuleSetDef) -> tuple[list[Badge], list[Badge]]:
    """화면용 — 앞 max_badges 개와 나머지(`<details>`)."""
    k = int(defn.p("news", "max_badges"))
    ordered = sort_badges(badges, defn)
    return ordered[:k], ordered[k:]


def runner_badges(
    entrant: Entrant,
    *,
    d: date,
    meet: str,
    distance: int | None,
    rank_change: RankChange | None,
    master: MasterRow | None,
    defn: RuleSetDef,
) -> list[Badge]:
    """한 말의 소식 배지 (우선순위 순 전체). 이력은 §1.1 출주만, race_date < H."""
    r, f = entrant.runner, entrant.feat
    cfg = defn.p("news")
    date_tmpl = str(defn.p("wording", "date_md"))

    def w(key: str, **kw: Any) -> str:
        return wording.render(defn, key, **kw)

    out: list[Badge] = []
    last = f.last

    # 기수 교체 (발행 시점 jockey_changes 행)
    jc = r.jockey_change
    if jc is not None:
        text = w("news_jockey_change", before=jc.before or "-", after=jc.after or "-")
        if jc.reason:
            text += w("news_jockey_change_reason", reason=jc.reason)
        wb, wa = jc.weight_before_tenths, jc.weight_after_tenths
        if wb is not None and wa is not None and wb != wa:
            text += w("news_jockey_change_weight", wb=parse.fmt_kg(wb), wa=parse.fmt_kg(wa))
        out.append(Badge("jockey_change", text))

    # 데뷔 / 기록 없음 · 휴양 복귀 / 짧은 간격
    if last is None:
        total = master.total_race_count if master is not None else None
        if total == 0:
            out.append(Badge("debut", w("news_debut")))
        else:
            out.append(Badge("no_record", w("news_no_record")))
    else:
        days = f.days_since_last
        assert days is not None
        if days >= int(cfg["layoff_days"]):
            rank = (
                w("rank_token", rank=last.rank)
                if last.rank is not None
                else w("rank_token_none")
            )
            text = w(
                "news_layoff",
                days=days,
                date=parse.fmt_md(last.race_date, date_tmpl),
                rank=rank,
            )
            out.append(Badge("layoff", text))
        elif days <= int(cfg["quick_return_days"]):
            out.append(Badge("quick_return", w("news_quick_return", days=days)))

    # 등급 변동 후 첫 출전 (마지막 출주일 < st_date ≤ D, 이력 없으면 st_date ≤ D)
    rc = rank_change
    if rc is not None and rc.st_date <= d and (last is None or last.race_date < rc.st_date):
        before = parse.norm_name(rc.before_rank)
        after = parse.norm_name(rc.after_rank)
        direction = w(class_direction(before, after))
        text = w(
            "news_class_change", before=before or "-", after=after or "-", direction=direction
        )
        out.append(Badge("class_change", text))

    # 레이팅 변화 · 개인 최고
    if r.rating is not None and f.rating_prev is not None:
        delta = r.rating - f.rating_prev
        if abs(delta) >= int(cfg["rating_change_min"]):
            key = "news_rating_change_up" if delta > 0 else "news_rating_change_down"
            text = w(key, delta=abs(delta), prev=f.rating_prev, now=r.rating)
            out.append(Badge("rating_change", text, delta=delta))
    if (
        r.rating is not None
        and f.max_rating is not None
        and f.rated_starts >= int(cfg["rating_high_min_rated_starts"])
        and r.rating > f.max_rating
    ):
        out.append(Badge("rating_high", w("news_rating_high")))

    # 거리
    if distance is not None and last is not None:
        min_m = int(cfg["distance_change_min_m"])
        if last.distance is not None and abs(distance - last.distance) >= min_m:
            text = w("news_distance_change", prev=last.distance, now=distance)
            out.append(Badge("distance_change", text))
        if distance not in f.distances:
            out.append(Badge("distance_first", w("news_distance_first", now=distance)))

    # 경마장 이동 · 조교사 변경 · 처음 탐
    if last is not None:
        if last.meet is not None and last.meet != meet:
            out.append(Badge("meet_move", w("news_meet_move", prev=last.meet)))
        if last.trainer_name and r.trainer_name and last.trainer_name != r.trainer_name:
            out.append(
                Badge(
                    "trainer_change",
                    w("news_trainer_change", prev=last.trainer_name, now=r.trainer_name),
                )
            )
        if r.jockey_name and r.jockey_name not in f.jockeys:
            out.append(Badge("first_pair", w("news_first_pair", jockey=r.jockey_name)))

    # 연승 · 직전 1착
    if f.win_streak >= int(cfg["win_streak_min"]):
        out.append(Badge("win_streak", w("news_win_streak", n=f.win_streak)))
    elif f.win_streak == 1 and last is not None:
        out.append(
            Badge("last_win", w("news_last_win", date=parse.fmt_md(last.race_date, date_tmpl)))
        )

    # 부담 변화 (유효 부담 vs 직전 출주 raw wgBudam)
    if r.budam_tenths is not None and last is not None and last.budam_tenths is not None:
        delta = r.budam_tenths - last.budam_tenths
        if abs(delta) >= int(cfg["budam_change_min_tenths"]):
            text = w(
                "news_budam_change",
                prev=parse.fmt_kg(last.budam_tenths),
                now=parse.fmt_kg(r.budam_tenths),
            )
            out.append(Badge("budam_change", text, delta=delta))

    return sort_badges(out, defn)


# ---------------------------------------------------------------------------
# 1면 헤드라인
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RaceNews:
    """헤드라인 입력 — 경주 하나 (출전마는 출전번호 순)."""

    race_no: int
    stakes: Mapping[str, Any] | None
    distance: int | None
    runners: tuple[tuple[Entrant, tuple[Badge, ...]], ...]


def build_headlines(races: Sequence[RaceNews], defn: RuleSetDef) -> tuple[list[Headline], int]:
    """호 전체 헤드라인 (최대 max_headlines) + 넘친 수."""
    cfg = defn.p("news")
    ordered = sorted(races, key=lambda r: r.race_no)

    def runners() -> list[tuple[int, Entrant, tuple[Badge, ...]]]:
        return [(race.race_no, e, b) for race in ordered for e, b in race.runners]

    def with_kind(kind: str) -> list[tuple[int, Entrant, Badge]]:
        out: list[tuple[int, Entrant, Badge]] = []
        for race_no, e, badges in runners():
            out.extend((race_no, e, b) for b in badges if b.kind == kind)
        out.sort(key=lambda x: (x[0], x[1].runner.chul_no, x[1].runner.horse_no))
        return out

    def runner_headline(kind: str, race_no: int, e: Entrant, b: Badge) -> Headline:
        return Headline(kind, race_no, e.runner.chul_no, e.runner.horse_no, b.text)

    def summary(kind: str, badge_kind: str) -> list[Headline]:
        n = len(with_kind(badge_kind))
        if n < 1:
            return []
        return [Headline(kind, None, None, None, wording.render(defn, f"headline_{kind}", n=n))]

    by_kind: dict[str, list[Headline]] = {
        "stakes": [
            Headline(
                "stakes",
                race.race_no,
                None,
                None,
                stakes_text(race.race_no, race.stakes, race.distance, defn),
            )
            for race in ordered
            if race.stakes is not None
        ],
        "jockey_change": [
            runner_headline("jockey_change", *x) for x in with_kind("jockey_change")
        ],
        "class_change": [runner_headline("class_change", *x) for x in with_kind("class_change")],
        "layoff": [
            runner_headline("layoff", *x)
            for x in with_kind("layoff")
            if (x[1].feat.days_since_last or 0) >= int(cfg["layoff_headline_days"])
        ][: int(cfg["layoff_headline_max"])],
        "win_streak": [
            runner_headline("win_streak", *x)
            for x in with_kind("win_streak")
            if x[1].feat.win_streak >= int(cfg["win_streak_headline_min"])
        ],
        "summary_trainer_change": summary("summary_trainer_change", "trainer_change"),
        "summary_debut": summary("summary_debut", "debut"),
        "summary_meet_move": summary("summary_meet_move", "meet_move"),
    }

    cands: list[Headline] = []
    for kind in defn.p("news", "headline_priority"):
        cands.extend(by_kind.get(kind, []))
    cap = int(cfg["max_headlines"])
    return cands[:cap], max(0, len(cands) - cap)
