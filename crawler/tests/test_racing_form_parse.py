"""경마지 파싱·정규화 (계획 §9.1: 레이팅·기록·거리·부담·'부산경남'·jkNo 앞자리 0)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from src.racing_form import definitions, parse

R1 = definitions.get("r1")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("65", 65),
        (65, 65),
        (" 65 ", 65),
        ("65.0", 65),
        (Decimal("65"), 65),
        (0, None),
        ("0", None),
        ("", None),
        ("-", None),
        (None, None),
        (-3, None),
        ("65.5", None),
        ("abc", None),
        (True, None),
    ],
)
def test_parse_rating(value: object, expected: int | None) -> None:
    assert parse.parse_rating(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [("3", 3), (3, 3), ("03", 3), (3.0, 3), ("0", None), ("", None), (None, None), ("x", None)],
)
def test_parse_pos_int(value: object, expected: int | None) -> None:
    assert parse.parse_pos_int(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("54.0", 540),
        ("54", 540),
        (54, 540),
        (54.5, 545),
        (Decimal("55.5"), 555),
        ("53.05", 531),  # ROUND_HALF_UP
        (0.1 + 0.2, 3),  # 이진 오차 없이
        ("-", None),
        ("", None),
        (None, None),
        ("0", None),
        ("-1", None),
        ("abc", None),
        (float("nan"), None),
        (float("inf"), None),
    ],
)
def test_parse_tenths(value: object, expected: int | None) -> None:
    assert parse.parse_tenths(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("72.8", 728),
        ("72.80", 728),
        ("1:12.8", 728),
        (" 1:12.8 ", 728),
        ("2:01.0", 1210),
        (72.8, 728),
        (Decimal("72.80"), 728),
        (999, 9990),
        ("-", None),
        ("0", None),
        ("0.00", None),
        ("", None),
        (None, None),
        ("1:xx", None),
        ("-72.8", None),
    ],
)
def test_parse_time_tenths(value: object, expected: int | None) -> None:
    assert parse.parse_time_tenths(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (1200, 1200),
        ("1200", 1200),
        ("1200m", 1200),
        (" 1400 ", 1400),
        (800, 800),
        (3000, 3000),
        (799, None),
        (3001, None),
        (0, None),
        ("", None),
        (None, None),
        ("1,200", None),
        ("abc", None),
    ],
)
def test_parse_distance(value: object, expected: int | None) -> None:
    assert parse.parse_distance(value, R1) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("서울", "서울"),
        (" 서울 ", "서울"),
        ("부경", "부경"),
        ("부산경남", "부경"),
        ("제주", "제주"),
        ("알수없음", None),
        ("영천", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_meet(value: object, expected: str | None) -> None:
    assert parse.normalize_meet(value) == expected


def test_norm_name() -> None:
    assert parse.norm_name("  김기수 ") == "김기수"
    assert parse.norm_name("") is None
    assert parse.norm_name("   ") is None
    assert parse.norm_name(None) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [("00123", "123"), ("123", "123"), (" 0123 ", "123"), ("000", None), ("", None), (None, None)],
)
def test_norm_jk_no(value: object, expected: str | None) -> None:
    assert parse.norm_jk_no(value) == expected


def test_distinct_jk_ids_null_mix_is_not_homonym() -> None:
    # NULL·빈 값과 번호가 섞여도 정규화 번호가 하나면 1 (동명이인 아님)
    assert parse.distinct_jk_ids([None, "", "00123", "123", " 0123"]) == 1
    assert parse.distinct_jk_ids([None, None]) == 0
    assert parse.distinct_jk_ids(["123", "456", None]) == 2


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("국5", ("국", 5)),
        ("국 5", ("국", 5)),
        ("국5등급", ("국", 5)),
        ("혼4", ("혼", 4)),
        (" 혼 4 등급 ", ("혼", 4)),
        ("5등급", ("", 5)),
        ("국OPEN", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_class_label(value: object, expected: tuple[str, int] | None) -> None:
    assert parse.normalize_class_label(value) == expected


def test_formatters() -> None:
    assert parse.fmt_kg(550) == "55.0"
    assert parse.fmt_kg(545) == "54.5"
    assert parse.fmt_kg(5) == "0.5"
    assert parse.fmt_md(date(2026, 11, 1)) == "11월 1일"
    assert parse.fmt_md(date(2026, 1, 9), str(R1.p("wording", "date_md"))) == "1월 9일"
    assert parse.fmt_hhmm("10:35") == "10:35"
    assert parse.fmt_hhmm("935") == "09:35"
    assert parse.fmt_hhmm("9:30:00") == "09:30"
    assert parse.fmt_hhmm("25:00") is None
    assert parse.fmt_hhmm("") is None
    assert parse.fmt_hhmm(None) is None


def test_integer_helpers() -> None:
    assert [parse.ceil_half(n) for n in (4, 5, 6, 7, 8)] == [2, 3, 3, 4, 4]
    assert parse.pct(15, 84) == 18  # (1500 + 42) // 84
    assert parse.pct(1, 8) == 13  # 12.5 → 13 (반올림)
    assert parse.pct(0, 20) == 0
    with pytest.raises(ValueError):
        parse.pct(1, 0)
