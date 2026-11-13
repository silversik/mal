"""경마지 일정 규칙 — 웹과 공유하는 벡터(schedule_vectors.json) 전부 + 경계."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from src.racing_form import definitions, schedule

R1 = definitions.get("r1")
VECTORS: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "racing_form" / "schedule_vectors.json").read_text(
        encoding="utf-8"
    )
)


def _d(s: str) -> date:
    return date.fromisoformat(s)


def _t(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


@pytest.mark.parametrize("v", VECTORS["dates"], ids=lambda v: v["race_date"])
def test_dates(v: dict[str, Any]) -> None:
    d = _d(v["race_date"])
    assert schedule.history_before(d, R1) == _d(v["history_before"])
    assert schedule.freeze_at(d, R1) == _t(v["freeze_at"])
    assert schedule.freeze_at(d, R1).isoformat() == v["freeze_at"]
    assert schedule.finalize_at(d, R1) == _t(v["finalize_at"])
    assert schedule.race_void_all_null_after(d, R1) == _t(v["race_void_all_null_after"])
    assert schedule.void_after(d, R1) == _d(v["void_after"])
    late_limit = _t(v["late_limit"])
    assert not schedule.is_late(late_limit, d, R1)
    assert schedule.is_late(late_limit + timedelta(microseconds=1), d, R1)


@pytest.mark.parametrize(
    "v", VECTORS["deadlines"], ids=lambda v: f"{v['race_date']}-{v['first_post']}"
)
def test_deadlines(v: dict[str, Any]) -> None:
    got = schedule.deadline_at(_d(v["race_date"]), v["first_post"], R1)
    assert got == _t(v["deadline_at"])


@pytest.mark.parametrize("v", VECTORS["windows"], ids=lambda v: v["now"])
def test_windows(v: dict[str, Any]) -> None:
    d, now = _d(v["race_date"]), _t(v["now"])
    assert schedule.in_window(now, d, v["first_post"], R1) is v["in_window"]
    assert schedule.is_past_deadline(now, d, v["first_post"], R1) is v["past_deadline"]


@pytest.mark.parametrize("v", VECTORS["late"], ids=lambda v: v["published_at"])
def test_late(v: dict[str, Any]) -> None:
    assert schedule.is_late(_t(v["published_at"]), _d(v["race_date"]), R1) is v["late"]


def test_vectors_cover_plan_cases() -> None:
    """계획 §9.1 — 금·토·일·공휴일 월요일·월말·연말·윤년, 17:59 / 18:00 / 07:00 / 08:00."""
    days = {_d(v["race_date"]).weekday() for v in VECTORS["dates"]}
    assert {4, 5, 0} <= days  # 금·토·월(공휴일) — 일요일은 아래 test_sunday_after_saturday
    nows = {_t(v["now"]).astimezone(schedule.KST).strftime("%H:%M") for v in VECTORS["windows"]}
    assert {"17:59", "18:00", "07:00", "08:00"} <= nows


def test_sunday_after_saturday() -> None:
    """일요일 호(토→일 연속 경주일): H = 토요일 → 토요일 결과는 이력에서 빠진다."""
    d = date(2026, 11, 15)
    assert d.weekday() == 6
    assert schedule.history_before(d, R1) == date(2026, 11, 14)
    assert schedule.freeze_at(d, R1) == _t("2026-11-14T18:00:00+09:00")
    assert schedule.deadline_at(d, "10:35", R1) == _t("2026-11-15T08:00:00+09:00")
    assert schedule.finalize_at(d, R1) == _t("2026-11-16T13:00:00+09:00")
    assert schedule.void_after(d, R1) == date(2026, 11, 22)
    assert schedule.in_window(_t("2026-11-14T18:00:00+09:00"), d, "10:35", R1)
    assert not schedule.in_window(_t("2026-11-14T17:59:59+09:00"), d, "10:35", R1)


def test_naive_now_rejected() -> None:
    with pytest.raises(ValueError):
        schedule.scheduled_minute(datetime(2026, 11, 13, 18, 0))
    with pytest.raises(ValueError):
        schedule.kst_today(datetime(2026, 11, 13, 18, 0))


def test_kst_today_crosses_utc_midnight() -> None:
    # UTC 15:30 = KST 다음날 00:30
    assert schedule.kst_today(_t("2026-11-13T15:30:00Z")) == date(2026, 11, 14)
