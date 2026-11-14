"""경마지 입력 값 파싱·정규화 (순수 함수).

- DB numeric·jsonb 숫자는 TEXT 로 받아 여기서 정수로 바꾼다 (`54.0` / `"54.0"` 혼재).
- payload 에는 float 가 없다: 부담·기록은 0.1 단위 정수(tenths), 거리는 m, 비율은 정수 퍼센트.
  float 입력도 받지만 `Decimal(repr(x))` 로 바꿔 계산하므로 이진 오차가 끼지 않는다.
- 반올림은 ROUND_HALF_UP (SQL numeric round 와 같음).
  KRA 기록은 0.1초 단위라 실제로는 거의 쓰이지 않는다.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from .definitions import RuleSetDef

#: 경마지가 다루는 경마장 (DB 저장 라벨)
VALID_MEETS: tuple[str, ...] = ("서울", "부경", "제주")

_MEET_ALIASES: dict[str, str] = {
    "서울": "서울",
    "부경": "부경",
    "부산경남": "부경",
    "제주": "제주",
}

_DIST_RE = re.compile(r"^\s*(\d+)\s*[mM]?\s*$")
_CLASS_RE = re.compile(r"^\s*([^\d\s]*)\s*(\d+)\s*(?:등급)?\s*$")
_HHMM_RE = re.compile(r"^\s*(\d{1,2}):?(\d{2})(?::\d{2})?\s*$")


def _to_decimal(value: Any) -> Decimal | None:
    """숫자·숫자 문자열 → Decimal. 빈 값·'-'·NaN·무한대·bool → None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        dec = value
    elif isinstance(value, int):
        dec = Decimal(value)
    elif isinstance(value, float):
        if not math.isfinite(value):
            return None
        dec = Decimal(repr(value))
    else:
        s = str(value).strip()
        if not s or s == "-":
            return None
        try:
            dec = Decimal(s)
        except InvalidOperation:
            return None
    if not dec.is_finite():
        return None
    return dec


def _round_int(dec: Decimal) -> int:
    return int(dec.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def parse_pos_int(value: Any) -> int | None:
    """양의 정수 (`"3"`·`3`·`"3.0"` → 3). 0 이하·소수·파싱 실패 → None."""
    dec = _to_decimal(value)
    if dec is None or dec <= 0 or dec != dec.to_integral_value():
        return None
    return int(dec)


def parse_tenths(value: Any) -> int | None:
    """kg 등 → 0.1 단위 정수 (`"54.0"` → 540, `"54"` → 540). 0 이하·'-'·빈 값 → None."""
    dec = _to_decimal(value)
    if dec is None or dec <= 0:
        return None
    return _round_int(dec * 10)


def parse_time_tenths(value: Any) -> int | None:
    """경주 기록(초) → 0.1초 단위 정수.

    `"72.8"`·`"72.80"`·`"1:12.8"`(분:초) → 728. `"-"`·`"0"`·빈 값·음수 → None.
    """
    if isinstance(value, str) and ":" in value:
        mins, _, secs = value.strip().partition(":")
        m = _to_decimal(mins)
        s = _to_decimal(secs)
        if m is None or s is None or m < 0 or m != m.to_integral_value():
            return None
        dec: Decimal | None = m * 60 + s
    else:
        dec = _to_decimal(value)
    if dec is None or dec <= 0:
        return None
    return _round_int(dec * 10)


def parse_distance(value: Any, defn: RuleSetDef) -> int | None:
    """거리(m) — `1200`·`"1200"`·`"1200m"`. defn.distance 범위(800~3000) 밖이면 None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, str):
        m = _DIST_RE.match(value)
        n = int(m.group(1)) if m else None
    else:
        n = parse_pos_int(value)
    if n is None:
        return None
    lo, hi = int(defn.p("distance", "min_m")), int(defn.p("distance", "max_m"))
    return n if lo <= n <= hi else None


def normalize_meet(value: Any) -> str | None:
    """'부산경남' → '부경'. 서울·부경·제주 외(알수없음 등) → None."""
    if value is None:
        return None
    return _MEET_ALIASES.get(str(value).strip())


def norm_name(value: Any) -> str | None:
    """이름 정규화 — strip, 빈 문자열은 None (SQL btrim + NULLIF '' 와 같음)."""
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def norm_jk_no(value: Any) -> str | None:
    """기수번호 정규화 — strip 후 앞자리 0 제거, 빈 값 → None.

    SQL `NULLIF(ltrim(btrim(jkNo), '0'), '')` 와 같다 ("00123" ≡ "123", "000" → None).
    """
    if value is None:
        return None
    s = str(value).strip().lstrip("0")
    return s or None


def distinct_jk_ids(values: Iterable[Any]) -> int:
    """동명이인 판정용 — 정규화한 기수번호의 서로 다른 개수 (NULL·빈 값 제외).

    SQL `COUNT(DISTINCT NULLIF(ltrim(btrim(raw->>'jkNo'),'0'),''))` 의 Python 판.
    NULL 과 번호가 섞여 있어도 번호가 하나뿐이면 1 (동명이인 아님).
    """
    return len({n for n in (norm_jk_no(v) for v in values) if n is not None})


def parse_rating(value: Any) -> int | None:
    """레이팅 — 양의 정수만 (`"65"` → 65). 0 이하·빈 값·파싱 실패 = 미평가(None)."""
    return parse_pos_int(value)


def normalize_class_label(value: Any) -> tuple[str, int] | None:
    """등급 라벨 → (접두, 숫자). `'국5'`·`'국 5'`·`'국5등급'` → ('국', 5), `'혼4'` → ('혼', 4).

    숫자가 없으면(`'국OPEN'` 등) None.
    """
    if value is None:
        return None
    m = _CLASS_RE.match(str(value))
    if not m:
        return None
    return m.group(1), int(m.group(2))


def fmt_kg(tenths: int) -> str:
    """0.1kg 정수 → `"55.0"`."""
    if tenths < 0:
        return "-" + fmt_kg(-tenths)
    return f"{tenths // 10}.{tenths % 10}"


def fmt_md(d: date, template: str = "{m}월 {d}일") -> str:
    """날짜 → `"11월 1일"` (template 은 definitions wording 의 date_md)."""
    return template.format(m=d.month, d=d.day)


def fmt_hhmm(value: Any) -> str | None:
    """발주 시각 정규화 — `'10:35'`·`'1035'`·`'9:30:00'` → `'10:35'`·`'09:30'`. 이상하면 None."""
    if value is None:
        return None
    m = _HHMM_RE.match(str(value))
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2))
    if h > 23 or mi > 59:
        return None
    return f"{h:02d}:{mi:02d}"


def ceil_half(n: int) -> int:
    """⌈n/2⌉ (정수)."""
    return (n + 1) // 2


def pct(w: int, n: int) -> int:
    """표시용 정수 퍼센트 `(100·w + n//2) // n` (n > 0)."""
    if n <= 0:
        raise ValueError("pct: n must be positive")
    return (100 * w + n // 2) // n
