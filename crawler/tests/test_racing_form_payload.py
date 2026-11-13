"""payload v1 (계약 §4) — float 없음·결정성·summary 일치·글리프/금지어·골든 파일.

골든 파일 `fixtures/racing_form/payload_v1.golden.json` 은 결정적 가짜 시나리오
(racing_form_fakes.payload_scenario: 3경주 — 보통·대상경주·small_field, 기수 교체·데뷔·휴양 복귀)
로 만든다. 웹 vitest 가 같은 파일을 파싱한다.
다시 만들려면: `RACING_FORM_UPDATE_GOLDEN=1 uv run pytest -q tests/test_racing_form_payload.py`
"""

from __future__ import annotations

import copy
import json
import os
import random
from pathlib import Path
from typing import Any

import pytest
from racing_form_fakes import GOLDEN_D, GOLDEN_MEET, GOLDEN_NOW, payload_scenario

from src.racing_form import build, definitions, payload, wording
from src.racing_form.payload import PayloadError, canonical_json, validate_v1

R1 = definitions.get("r1")
GOLDEN = Path(__file__).parent / "fixtures" / "racing_form" / "payload_v1.golden.json"


def _build(provider: Any = None) -> build.BuildResult:
    return build.build_edition(
        provider or payload_scenario(), GOLDEN_D, GOLDEN_MEET, GOLDEN_NOW, R1, mode="live"
    )


@pytest.fixture(scope="module")
def built() -> build.BuildResult:
    return _build()


def _texts(pl: dict[str, Any]) -> list[tuple[str, str]]:
    """(종류, 문장) — 근거·예상 안 함 사유·소식 배지·헤드라인."""
    out: list[tuple[str, str]] = []
    for race in pl["races"]:
        for rr in race["rules"]:
            if rr["status"] == "picked":
                out += [(f"reason:{rr['key']}", p["reason"]) for p in rr["picks"]]
            else:
                out.append((f"no_pick:{rr['key']}", rr["reason"]))
        for p in race["consensus"]["picks"]:
            out += [("consensus", r) for r in p["reasons"]]
        for runner in race["runners"]:
            out += [(f"badge:{b['kind']}", b["text"]) for b in runner["badges"]]
    out += [(f"headline:{h['kind']}", h["text"]) for h in pl["headlines"]]
    return out


def test_golden_file(built: build.BuildResult) -> None:
    text = json.dumps(built.payload, sort_keys=True, ensure_ascii=False, indent=2) + "\n"
    if os.environ.get("RACING_FORM_UPDATE_GOLDEN") == "1":
        GOLDEN.write_text(text, encoding="utf-8")
    assert GOLDEN.exists(), "골든 파일 없음 — RACING_FORM_UPDATE_GOLDEN=1 로 생성"
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert golden == built.payload
    assert canonical_json(golden) == canonical_json(built.payload)
    validate_v1(golden)


def test_scenario_covers_required_cases(built: build.BuildResult) -> None:
    pl = built.payload
    statuses = [r["status"] for r in pl["races"]]
    assert len(pl["races"]) >= 3 and "small_field" in statuses
    assert any(r["stakes"] is not None for r in pl["races"])
    kinds = {b["kind"] for r in pl["races"] for x in r["runners"] for b in x["badges"]}
    assert {"jockey_change", "debut", "layoff", "no_record", "class_change"} <= kinds
    assert any(r["consensus"]["status"] == "picked" for r in pl["races"])
    assert pl["headline_overflow"] > 0
    assert pl["edition"]["warnings"] == ["unresolved_history:2026-11-09|서울"]


def test_no_floats_anywhere(built: build.BuildResult) -> None:
    def walk(v: Any) -> None:
        assert not isinstance(v, float), v
        if isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(built.payload)
    bad = copy.deepcopy(built.payload)
    bad["races"][0]["runners"][0]["rating"] = 72.0
    with pytest.raises(PayloadError, match="float"):
        validate_v1(bad)


def test_canonical_json_deterministic_under_input_order() -> None:
    a = canonical_json(_build().payload)
    for seed in range(3):
        p = payload_scenario()
        rng = random.Random(seed)
        rng.shuffle(p.entry_rows)
        rng.shuffle(p.result_rows)
        rng.shuffle(p.rank_change_rows)
        assert canonical_json(_build(p).payload) == a
    assert a == json.dumps(json.loads(a), sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def test_summary_equals_recomputed(built: build.BuildResult) -> None:
    pl = built.payload
    assert pl["summary"] == payload.build_summary(pl)
    s = pl["summary"]
    assert s["race_count"] == len(pl["races"]) == built.meta["race_count"]
    assert (
        s["runner_count"] == sum(r["field_size"] for r in pl["races"]) == built.meta["runner_count"]
    )
    assert s["counts"]["headlines"] == len(pl["headlines"])
    bad = copy.deepcopy(pl)
    bad["summary"]["race_count"] += 1
    with pytest.raises(PayloadError, match="summary"):
        validate_v1(bad)


def test_texts_have_no_glyphs_or_forbidden_words(built: build.BuildResult) -> None:
    texts = _texts(built.payload)
    assert len(texts) > 30
    for kind, text in texts:
        assert wording.find_forbidden(text) == [], (kind, text)
        if kind != "badge:rating_change":
            assert "▲" not in text and "▼" not in text, (kind, text)
    assert any("▲" in t for k, t in texts if k == "badge:rating_change")


def test_ordering(built: build.BuildResult) -> None:
    races = built.payload["races"]
    assert [r["race_no"] for r in races] == sorted(r["race_no"] for r in races)
    for race in races:
        chuls = [x["chul_no"] for x in race["runners"]]
        assert chuls == sorted(chuls)
        assert [r["key"] for r in race["rules"]] == list(R1.rules)
        for x in race["runners"]:
            dates = [(s["race_date"], s["race_no"]) for s in x["last5"]]
            assert dates == sorted(dates) and len(dates) <= 5
    assert [r["key"] for r in built.payload["rules"]] == list(R1.rules)


def test_picks_rows(built: build.BuildResult) -> None:
    rows = built.picks
    pl = built.payload
    n_rule = sum(
        len(rr["picks"]) for r in pl["races"] for rr in r["rules"] if rr["status"] == "picked"
    )
    n_cons = sum(len(r["consensus"]["picks"]) for r in pl["races"])
    assert len(rows) == n_rule + n_cons
    assert all(r["votes"] is None for r in rows if r["rule_key"] != "consensus")
    cons = [r for r in rows if r["rule_key"] == "consensus"]
    assert cons and all(r["mark"] in (1, 2) and r["votes"] >= 3 for r in cons)
    first = cons[0]
    race1 = pl["races"][0]
    assert first["reason"] == " · ".join(race1["consensus"]["picks"][0]["reasons"])
    assert {r["rule_version"] for r in rows} == {"r1"}
    assert {r["race_date"] for r in rows} == {GOLDEN_D}
    keys = {(r["race_no"], r["rule_key"], r["mark"]) for r in rows}
    assert len(keys) == len(rows)  # uq_rf_picks_mark
    assert {(r["race_no"], r["rule_key"], r["horse_no"]) for r in rows}.__len__() == len(rows)
    assert all(r["horse_name"] for r in rows)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda p: p.pop("headlines"),
        lambda p: p["edition"].pop("freeze_at"),
        lambda p: p.__setitem__("schema_version", 2),
        lambda p: p["races"].reverse(),
        lambda p: p["races"][0]["runners"].reverse(),
        lambda p: p["races"][0]["runners"][0]["last5"].reverse(),
        lambda p: p["races"][0]["rules"].reverse(),
        lambda p: p["races"][0]["runners"][0]["marks"].clear(),
        lambda p: p["races"][0]["consensus"].__setitem__("active_rules", 3),
        lambda p: p["races"][0]["rules"][0]["picks"][0].__setitem__("chul_no", 99),
        lambda p: p["races"][0].__setitem__("extra", 1),
        lambda p: p["edition"].__setitem__("freeze_at", "2026-11-14T09:00:00Z"),
        lambda p: p["headlines"].extend([p["headlines"][0]] * 6),
    ],
)
def test_validate_rejects(built: build.BuildResult, mutate: Any) -> None:
    bad = copy.deepcopy(built.payload)
    mutate(bad)
    with pytest.raises(PayloadError):
        validate_v1(bad)


def test_validate_accepts_built(built: build.BuildResult) -> None:
    validate_v1(built.payload)
    validate_v1(json.loads(canonical_json(built.payload)))
