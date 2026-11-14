"""경마지 기준 정의 — 해시 핀 + 라벨·키 정합성.

⚠ 아래 해시는 **고정값**이다. definitions.py 의 r1·r1-e2e 수치·문구·정책을 바꾸면 이 테스트가
깨진다 — 값을 바꾸려면 기존 버전을 고치지 말고 **새 버전(r2 …)을 추가**하고 그 해시를 새로 핀한다
(발행된 호는 rules_version 의 정의 해시로 검증된다 — healthcheck·ensure_rule_set).
"""

from __future__ import annotations

import json

import pytest

from src.racing_form import definitions, wording
from src.racing_form.definitions import RULE_DEFINITIONS, RULE_KEYS, RULE_LABELS, RULE_SETS

PINNED_SHA256 = {
    "r1": "a3144ab4f55f4e5f223ee23de2f14a418f0f2169ed5cb8c21b6b74570f8673a4",
    "r1-e2e": "0af1ee3611281e065ae09dfa26d006ac16b9cfbc295701d9f5b4959b7bebec16",
}


@pytest.mark.parametrize("version", sorted(PINNED_SHA256))
def test_definition_hash_pinned(version: str) -> None:
    assert definitions.definition_sha256(RULE_SETS[version]) == PINNED_SHA256[version]


def test_every_registered_version_is_pinned() -> None:
    assert set(RULE_SETS) == set(PINNED_SHA256)


def test_definition_json_is_canonical_and_float_free() -> None:
    for defn in RULE_SETS.values():
        text = definitions.definition_json(defn)
        obj = json.loads(text)
        assert text == json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

        def walk(v: object) -> None:
            assert not isinstance(v, float), v
            if isinstance(v, dict):
                for x in v.values():
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)

        walk(obj)


def test_labels_and_keys() -> None:
    assert RULE_KEYS == ("rating", "form", "course", "jockey", "trainer")
    assert set(RULE_LABELS) == set(RULE_KEYS) == set(RULE_DEFINITIONS)
    assert RULE_LABELS == {
        "rating": "레이팅",
        "form": "최근 성적",
        "course": "거리 적성",
        "jockey": "기수",
        "trainer": "조교사",
    }
    for defn in RULE_SETS.values():
        assert defn.version in RULE_SETS
        assert defn.rules == ("rating", "form", "course", "jockey")
        assert defn.backtest_extra_rules == ("trainer",)
        assert not set(defn.rules) & set(defn.backtest_extra_rules)
        assert set(defn.rules) | set(defn.backtest_extra_rules) <= set(RULE_KEYS)


def test_active_reads_module_attribute(monkeypatch: pytest.MonkeyPatch) -> None:
    assert definitions.active().version == definitions.ACTIVE == "r1"
    monkeypatch.setattr(definitions, "ACTIVE", "r1-e2e")
    assert definitions.active().version == "r1-e2e"


def test_e2e_variant_differs_only_in_documented_params() -> None:
    a = RULE_SETS["r1"].to_json_obj()["params"]
    b = RULE_SETS["r1-e2e"].to_json_obj()["params"]
    assert b["field"]["min_active"] == 3
    assert b["guards"]["max_all_nopick_races_pct"] == 100
    b["field"]["min_active"] = a["field"]["min_active"]
    b["guards"]["min_veterans_for_coverage"] = a["guards"]["min_veterans_for_coverage"]
    b["guards"]["max_all_nopick_races_pct"] = a["guards"]["max_all_nopick_races_pct"]
    assert a == b


@pytest.mark.parametrize("version", sorted(PINNED_SHA256))
def test_wording_templates_have_no_forbidden_words(version: str) -> None:
    assert wording.template_violations(RULE_SETS[version]) == []


def test_rule_definitions_have_no_forbidden_words() -> None:
    for key, text in RULE_DEFINITIONS.items():
        assert wording.is_clean(text), key
        assert wording.is_clean(RULE_LABELS[key]), key


def test_news_priority_lists_are_complete() -> None:
    news = RULE_SETS["r1"].p("news")
    assert len(set(news["badge_priority"])) == len(news["badge_priority"])
    assert set(news["headline_priority"]) == {
        "stakes",
        "jockey_change",
        "class_change",
        "layoff",
        "win_streak",
        "summary_trainer_change",
        "summary_debut",
        "summary_meet_move",
    }
    assert news["max_badges"] == 3
    assert news["max_headlines"] == 6


def test_forbidden_words_file_is_package_relative() -> None:
    from pathlib import Path

    pkg = Path(wording.__file__).resolve().parent
    assert pkg / "data" / "forbidden_words.json" == wording.FORBIDDEN_PATH
    assert wording.forbidden_glyphs() == ("◎", "○", "△")
    assert "추천" in wording.forbidden_words() and "보장" in wording.forbidden_words()
    assert wording.find_forbidden("레이팅 ▲4 (64→68)") == []
    assert wording.find_forbidden("강력 추천 ◎") == ["강력", "추천", "◎"]
    with pytest.raises(ValueError):
        wording.assert_clean("무조건 대박", "test")
