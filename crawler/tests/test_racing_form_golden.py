"""r1 기준 conformance — fixtures/racing_form/golden_r1.json 의 20경주 (손으로 유도한 기대값).

정의 해시가 테스트(정의 핀)로 못 잡는 로직 변경(정렬·자격·문구 조립)을 막는다.
골든은 코드 출력 덤프가 아니다 — 어긋나면 계약을 다시 읽고 어느 쪽이 틀렸는지 판단할 것.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from racing_form_fakes import FakeProvider, kst

from src.racing_form import build, definitions

GOLDEN: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "racing_form" / "golden_r1.json").read_text(
        encoding="utf-8"
    )
)
DEFN = definitions.get(GOLDEN["rules_version"])
D = date.fromisoformat(GOLDEN["race_date"])
H = D - timedelta(days=1)
MEET = GOLDEN["meet"]

FORM_DIST = 2300  # 최근 성적용 출주 거리 — 어떤 골든 경주 거리와도 겹치지 않음
COURSE_BASE_AGO = 500  # 거리 적성용 출주는 1년보다 전 (최근 성적 창 밖)


def _add_start(
    p: FakeProvider,
    horse_no: str,
    item: Any,
    *,
    default_ago: int,
    default_dist: int | None,
    race_no: int,
) -> None:
    if isinstance(item, dict):
        r = item["r"]
        ago = int(item.get("ago", default_ago))
        dist = item.get("dist", default_dist)
        meet = item.get("meet", MEET)
    else:
        r, ago, dist, meet = item, default_ago, default_dist, MEET
    if r == "x":  # 미출주 — 착순·기록 없음
        rank, time = None, None
    elif r is None:  # 순위 없음 — 기록 있음
        rank, time = None, "73.0"
    else:
        rank, time = int(r), "72.0"
    p.add_result(H - timedelta(days=ago), meet, race_no, horse_no, rank, time=time, distance=dist)


def build_world(spec: dict[str, Any]) -> FakeProvider:
    p = FakeProvider()
    for race in spec["races"]:
        rn = race["race_no"]
        p.add_race(D, MEET, rn, distance=race["distance"], raw_rc_dist=race.get("raw_rc_dist"))
        for name, (rides, wins, top3, ids) in race.get("jockeys", {}).items():
            p.set_jockey_stat(name, MEET, rides, wins, top3, ids)
        for rs in race["runners"]:
            chul = rs["chul"]
            hn = f"G{rn:02d}{chul:02d}"
            p.add_entry(D, MEET, rn, hn, chul, rating=rs.get("rating"), jockey=rs.get("jockey"))
            p.set_master(hn, 0)
            form = rs.get("form", [])
            for i, item in enumerate(form):
                _add_start(
                    p, hn, item, default_ago=7 * (len(form) - i), default_dist=FORM_DIST, race_no=1
                )
            course = rs.get("course", [])
            for i, item in enumerate(course):
                _add_start(
                    p,
                    hn,
                    item,
                    default_ago=COURSE_BASE_AGO + 7 * (len(course) - i),
                    default_dist=race["distance"],
                    race_no=2,
                )
            for item in rs.get("starts", []):
                _add_start(p, hn, item, default_ago=0, default_dist=FORM_DIST, race_no=3)
    return p


@pytest.fixture(scope="module")
def payload() -> dict[str, Any]:
    res = build.build_edition(
        build_world(GOLDEN), D, MEET, kst(2026, 11, 14, 18, 0), DEFN, "replay"
    )
    return res.payload


def test_golden_is_bound_to_definition_hash() -> None:
    # 기준 정의가 바뀌면(새 버전) 골든도 손으로 다시 유도해야 한다
    assert definitions.definition_sha256(DEFN) == GOLDEN["definition_sha256"]


def test_golden_shape_and_coverage() -> None:
    races = GOLDEN["races"]
    assert len(races) == 20
    assert [r["race_no"] for r in races] == list(range(1, 21))
    assert all(r["why"].strip() for r in races)
    codes = {
        e["no_pick"]
        for r in races
        for k, e in r["expected"].items()
        if k != "consensus" and "no_pick" in e
    }
    assert codes == {
        "small_field",
        "rating_no_pick",
        "form_no_pick_eligible",
        "form_no_pick_top3",
        "course_no_pick_distance",
        "course_no_pick_eligible",
        "course_no_pick_top3",
        "jockey_no_pick",
    }
    statuses = {r["expected"]["consensus"]["status"] for r in races}
    assert statuses == {"picked", "split", "insufficient", "small_field"}


@pytest.mark.parametrize("race", GOLDEN["races"], ids=lambda r: f"R{r['race_no']:02d}")
def test_golden_race(payload: dict[str, Any], race: dict[str, Any]) -> None:
    got = next(r for r in payload["races"] if r["race_no"] == race["race_no"])
    exp = race["expected"]
    assert got["field_size"] == len(race["runners"])
    by_key = {rr["key"]: rr for rr in got["rules"]}
    assert list(by_key) == list(DEFN.rules)
    for key in DEFN.rules:
        e, g = exp[key], by_key[key]
        if "picks" in e:
            assert g["status"] == "picked", (key, g)
            assert [[p["mark"], p["chul_no"]] for p in g["picks"]] == e["picks"], key
            if "reasons" in e:
                assert [p["reason"] for p in g["picks"]] == e["reasons"], key
        else:
            assert g["status"] == "no_pick", (key, g)
            assert g["reason_code"] == e["no_pick"], key
            if "reason" in e:
                assert g["reason"] == e["reason"], key

    ec, gc = exp["consensus"], got["consensus"]
    assert gc["status"] == ec["status"]
    assert gc["active_rules"] == ec["active_rules"]
    assert gc["min_votes"] == 3
    assert [[p["mark"], p["chul_no"], p["votes"]] for p in gc["picks"]] == ec["picks"]
    for det, gp in zip(ec.get("details", []), gc["picks"], strict=False):
        assert gp["marks"] == det["marks"]
        assert gp["reasons"] == det["reasons"]
        assert gp["reasons_more"] == det["reasons_more"]

    # 출전마 카드의 기호 = 기준 결과
    for runner in got["runners"]:
        marks = {
            k: m
            for k, rr in by_key.items()
            if rr["status"] == "picked"
            for p in rr["picks"]
            if p["horse_no"] == runner["horse_no"]
            for m in [p["mark"]]
        }
        assert runner["marks"] == marks
