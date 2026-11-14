"""발행·정산 일정 (KST). 순수 함수 — 현재 시각을 읽지 않는다.

- 동결·발행 freeze_at = (D-1) 18:00
- 마감 deadline_at = min(D 08:00, 첫 발주 - 60분). 첫 발주를 모르면 08:00
- 발행 창 = [freeze_at, deadline_at) 반열린 구간. 판정은 분 단위로 자른 예약 시각
- 늦게 발행 = published_at > freeze_at + 60분
- 과거 성적 기준 H = D-1 (race_date < H)
- 정산 확정 = (D+1) 13:00, 전부 rank NULL 인 경주 무효 판정 = (D+1) 12:30
- D+7 (그날 포함 이후) 까지 결과가 없으면 경주 무효

웹(`web/src/lib/racing_form-shared.ts`)이 같은 규칙을 구현하고,
`crawler/tests/fixtures/racing_form/schedule_vectors.json` 벡터를 양쪽 테스트가 함께 쓴다.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .definitions import RuleSetDef

KST = ZoneInfo("Asia/Seoul")

_HHMM = re.compile(r"^\s*(\d{1,2}):?(\d{2})(?::\d{2})?\s*$")


def at_kst(d: date, minutes: int) -> datetime:
    """d 의 00:00 KST 로부터 minutes 분 뒤 (tz-aware)."""
    return datetime.combine(d, time(0, 0), tzinfo=KST) + timedelta(minutes=minutes)


def parse_hhmm(value: str | None) -> int | None:
    """'10:35' / '1035' / '10:35:00' → 635 (자정 기준 분). 이상하면 None."""
    if value is None:
        return None
    m = _HHMM.match(str(value))
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return None
    return h * 60 + mi


def history_before(d: date, defn: RuleSetDef) -> date:
    """H — 과거 성적은 race_date < H 만 쓴다."""
    return d - timedelta(days=int(defn.p("history", "offset_days")))


def freeze_at(d: date, defn: RuleSetDef) -> datetime:
    return at_kst(d - timedelta(days=1), int(defn.p("schedule", "freeze_min")))


def deadline_at(d: date, first_post: str | None, defn: RuleSetDef) -> datetime:
    base = at_kst(d, int(defn.p("schedule", "deadline_min")))
    fp = parse_hhmm(first_post)
    if fp is None:
        return base
    cand = at_kst(d, fp) - timedelta(minutes=int(defn.p("schedule", "first_post_margin_min")))
    return min(base, cand)


def scheduled_minute(now: datetime) -> datetime:
    """판정용 예약 시각 — KST 로 바꿔 초 이하를 버린다."""
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(KST).replace(second=0, microsecond=0)


def in_window(now: datetime, d: date, first_post: str | None, defn: RuleSetDef) -> bool:
    t = scheduled_minute(now)
    return freeze_at(d, defn) <= t < deadline_at(d, first_post, defn)


def is_past_deadline(now: datetime, d: date, first_post: str | None, defn: RuleSetDef) -> bool:
    return scheduled_minute(now) >= deadline_at(d, first_post, defn)


def is_late(published_at: datetime, d: date, defn: RuleSetDef) -> bool:
    limit = freeze_at(d, defn) + timedelta(minutes=int(defn.p("schedule", "late_after_min")))
    return published_at > limit


def finalize_at(d: date, defn: RuleSetDef) -> datetime:
    return at_kst(d + timedelta(days=1), int(defn.p("settle", "finalize_after_min")))


def race_void_all_null_after(d: date, defn: RuleSetDef) -> datetime:
    return at_kst(d + timedelta(days=1), int(defn.p("settle", "race_void_all_null_after_min")))


def void_after(d: date, defn: RuleSetDef) -> date:
    """이 날짜(KST) 이후의 정산 실행에서 결과가 없는 경주를 무효로 확정한다."""
    return d + timedelta(days=int(defn.p("settle", "void_after_days")))


def kst_today(now: datetime) -> date:
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(KST).date()
