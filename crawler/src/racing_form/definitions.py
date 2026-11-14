"""데이터 예상단 기준 정의 레지스트리.

- 한 버전(r1, r2 …)은 한 번 발행에 쓰이면 바뀌지 않는다. 수치·문구·정책을 바꾸려면
  **새 버전을 추가**한다(과거 버전은 영구 보관 — healthcheck 가 DB 행과 대조).
- 정의 해시(definition_sha256) = 정렬 JSON(sort_keys, 고정 separators,
  ensure_ascii=False)의 SHA-256. SQL 로 재계산하지 않는다.
- pytest(test_racing_form_definitions.py)가 버전별 해시를 핀으로 고정한다 →
  값을 바꾸면 테스트가 깨지고 버전을 올리게 된다.
- ACTIVE 는 호출 시점에 모듈 속성으로 읽는다(`definitions.ACTIVE`). e2e 는 이를
  monkeypatch 로 "r1-e2e" 로 바꾼다.

모든 수치는 정수(퍼센트·분·일·m·0.1kg 단위)다. float 를 쓰지 않는다.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

# 기준 키 (표시·집계 순서 고정)
RULE_KEYS: tuple[str, ...] = ("rating", "form", "course", "jockey", "trainer")
CONSENSUS_KEY = "consensus"


@dataclass(frozen=True)
class RuleSetDef:
    """한 버전의 기준 묶음.

    rules: 발행·집계 대상 기준(화면 표시 순서). 주목마(consensus)는 이 기준들로만 계산.
    backtest_extra_rules: 과거 시험에서만 함께 평가하는 예비 기준(화면·발행에는 없음).
    params: 모든 수치·문구·정책 (중첩 dict, 값은 int/str/list/dict 만).
    """

    version: str
    rules: tuple[str, ...]
    backtest_extra_rules: tuple[str, ...] = ()
    params: dict[str, Any] = field(default_factory=dict)

    def to_json_obj(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "rules": list(self.rules),
            "backtest_extra_rules": list(self.backtest_extra_rules),
            "params": copy.deepcopy(self.params),
        }

    def p(self, *path: str) -> Any:
        """params 중첩 조회: defn.p("rules", "form", "window_days")."""
        cur: Any = self.params
        for key in path:
            cur = cur[key]
        return cur


# ---------------------------------------------------------------------------
# r1 — 1단계 기준 (레이팅·최근 성적·거리 적성·기수, 예비 조교사)
# ---------------------------------------------------------------------------

_R1_PARAMS: dict[str, Any] = {
    # 과거 성적 컷: race_results.race_date < H, H = D - history_offset_days
    "history": {"offset_days": 1},
    # 경주 단위: 활성 출전마가 min_active 미만이면 모든 기준 '예상 안 함'
    "field": {"min_active": 5},
    # 거리 파싱 인정 범위(m)
    "distance": {"min_m": 800, "max_m": 3000},
    # stale(출전표 최신 배치보다 오래된 행) 제외:
    #   updated_at < MAX(updated_at) - batch_tolerance_min.
    # 한 경주에서 max_drop_pct 를 넘게 빠지면 빼지 않고 경고만 남긴다.
    "stale": {"batch_tolerance_min": 30, "max_drop_pct": 50},
    "rules": {
        # 자격 수 < max(min_eligible_floor, ceil(N/2)) 이면 예상 안 함
        "rating": {"min_eligible_floor": 3},
        "form": {"window_days": 365, "last_n": 3, "min_starts": 2, "min_eligible_floor": 3},
        # 같은 경마장·같은 거리 통산(< H), 자격 수 < min_eligible 이면 예상 안 함
        "course": {"min_starts": 3, "min_eligible": 3},
        "jockey": {"window_days": 90, "min_rides": 20, "min_eligible": 3},
        "trainer": {"window_days": 90, "min_starts": 20, "min_eligible": 3},
    },
    # 주목마: 예상을 낸 기준 A >= min_active_rules, 고른 기준 수 v >= min_votes, 경주당 max_picks
    "consensus": {"min_active_rules": 3, "min_votes": 3, "max_picks": 2, "max_reasons": 2},
    # live 발행 데이터 가드(fail-closed). replay·backtest 에서는 끔.
    "guards": {
        "min_veterans_for_coverage": 10,
        "min_history_coverage_pct": 50,
        "max_all_nopick_races_pct": 50,
        "entries_stale_warn_hours": 6,
    },
    "news": {
        "layoff_days": 90,
        "layoff_headline_days": 180,
        "layoff_headline_max": 2,
        "quick_return_days": 14,
        "rating_change_min": 3,
        "rating_high_min_rated_starts": 2,
        "distance_change_min_m": 200,
        "budam_change_min_tenths": 20,
        "win_streak_min": 2,
        "win_streak_headline_min": 3,
        "max_badges": 3,
        "max_headlines": 6,
        # 배지 우선순위(앞이 먼저). 같은 순위 안에서는 kind 이름순.
        "badge_priority": [
            "jockey_change",
            "class_change",
            "layoff",
            "debut",
            "no_record",
            "first_pair",
            "distance_change",
            "distance_first",
            "budam_change",
            "rating_change",
            "rating_high",
            "trainer_change",
            "win_streak",
            "last_win",
            "meet_move",
            "quick_return",
        ],
        # 1면 헤드라인 우선순위
        "headline_priority": [
            "stakes",
            "jockey_change",
            "class_change",
            "layoff",
            "win_streak",
            "summary_trainer_change",
            "summary_debut",
            "summary_meet_move",
        ],
    },
    "settle": {
        # 결과 행이 발행 명단의 이 비율 미만이면 대기
        "pending_below_pct": 50,
        # 결과 행이 전부 rank NULL/0 이고 D+1 이 시각(분, KST) 이후면 경주 무효
        "race_void_all_null_after_min": 12 * 60 + 30,
        # 정산 확정 시각 D+1 (분, KST)
        "finalize_after_min": 13 * 60,
        # D+N 일까지 결과가 없으면 경주 무효 확정
        "void_after_days": 7,
        # 무효 정책: 발행 후 결과 행이 없는 말만 무효. 결과 행이 있으면 순위 밖 = 빗나감.
        "void_policy": "no_result_row_only",
    },
    "schedule": {
        # 동결·발행 = D-1 의 이 시각(분, KST)
        "freeze_min": 18 * 60,
        # 마감 = min(D 의 이 시각, 첫 발주 - first_post_margin_min)
        "deadline_min": 8 * 60,
        "first_post_margin_min": 60,
        # freeze + late_after_min 을 넘겨 발행하면 '늦게 발행'
        "late_after_min": 60,
    },
    # 문구 템플릿 — 근거·소식은 사실·숫자만. 발행본에 문장 그대로 동결된다.
    "wording": {
        "no_pick_small_field": "출전 {n}두 — {m}두 미만이라 예상 안 함",
        "rating_no_pick": "레이팅이 있는 말이 {e}두뿐 (최소 {m}두)",
        "form_no_pick_eligible": "최근 1년 2번 이상 뛴 말이 {e}두뿐 (최소 {m}두)",
        "form_no_pick_top3": "최근 3전에서 3착 안에 든 말이 없음",
        "course_no_pick_eligible": "이 경마장·거리에서 3번 이상 뛴 말이 {e}두뿐 (최소 {m}두)",
        "course_no_pick_distance": "거리 정보 없음",
        "course_no_pick_top3": "이 경마장·거리에서 3착 안에 든 말이 없음",
        "jockey_no_pick": "최근 90일 이 경마장에서 20번 이상 탄 기수의 말이 {e}두뿐 (최소 {m}두)",
        "trainer_no_pick": (
            "최근 90일 이 경마장에서 20번 이상 출주한 조교사의 말이 {e}두뿐 (최소 {m}두)"
        ),
        "rating_reason": "레이팅 {rating} · 출전 {n}두 중 {rank}위",
        "rating_reason_tie": "레이팅 {rating} · 출전 {n}두 중 공동 {rank}위(번호순)",
        "form_reason": "최근 {k}전 {seq} (3착 이내 {t}번)",
        "course_reason": "{meet} {distance}m {s}번 중 3착 이내 {t}번 (1착 {w}번)",
        "jockey_reason": "{name} 기수 · 최근 90일 {meet} {rides}번 중 {wins}승 (승률 {pct}%)",
        "trainer_reason": "{name} 조교사 · 최근 90일 {meet} {starts}번 중 {wins}승 (승률 {pct}%)",
        "rank_token": "{rank}착",
        "rank_token_none": "순위 없음",
        "seq_arrow": "→",
        "news_stakes": "{race_no}R {name} ({grade}, {distance}m)",
        "news_stakes_no_grade": "{race_no}R {name} ({distance}m)",
        "news_jockey_change": "기수 교체 {before}→{after}",
        "news_jockey_change_reason": " ({reason})",
        "news_jockey_change_weight": " · 부담 {wb}→{wa}kg",
        "news_debut": "데뷔전",
        "news_no_record": "mal.kr 수집 기록 없음",
        "news_layoff": "{days}일 만의 출전 (직전 {date} {rank})",
        "news_quick_return": "{days}일 만에 다시 출전",
        "news_class_change": "{before}→{after} {direction} 후 첫 출전",
        "class_down": "강급",
        "class_up": "승급",
        "class_other": "등급 변경",
        "news_rating_change_up": "레이팅 ▲{delta} ({prev}→{now})",
        "news_rating_change_down": "레이팅 ▼{delta} ({prev}→{now})",
        "news_rating_high": "레이팅 개인 최고",
        "news_distance_change": "거리 {prev}m→{now}m",
        "news_distance_first": "{now}m 첫 출전",
        "news_meet_move": "경마장 이동 (직전 {prev})",
        "news_trainer_change": "조교사 변경 {prev}→{now}",
        "news_first_pair": "{jockey} 기수가 이 말을 처음 탐",
        "news_win_streak": "{n}연승 중",
        "news_last_win": "직전 경주 1착 ({date})",
        "news_budam_change": "부담 {prev}→{now}kg",
        "headline_summary_trainer_change": "조교사 변경 {n}두",
        "headline_summary_debut": "데뷔 {n}두",
        "headline_summary_meet_move": "경마장 이동 {n}두",
        "date_md": "{m}월 {d}일",
    },
}

_R1_E2E_PARAMS: dict[str, Any] = copy.deepcopy(_R1_PARAMS)
# 가짜 세계는 경주당 3두 → 경주 단위 하한을 3 으로. 과거 결과가 없으므로 마스터 기반 가드는 끈다
# (가드 자체는 단위 테스트로 검증).
_R1_E2E_PARAMS["field"]["min_active"] = 3
_R1_E2E_PARAMS["guards"]["min_veterans_for_coverage"] = 1_000_000
_R1_E2E_PARAMS["guards"]["max_all_nopick_races_pct"] = 100


RULE_SETS: dict[str, RuleSetDef] = {
    "r1": RuleSetDef(
        version="r1",
        rules=("rating", "form", "course", "jockey"),
        backtest_extra_rules=("trainer",),
        params=_R1_PARAMS,
    ),
    "r1-e2e": RuleSetDef(
        version="r1-e2e",
        rules=("rating", "form", "course", "jockey"),
        backtest_extra_rules=("trainer",),
        params=_R1_E2E_PARAMS,
    ),
}

#: 발행에 쓰는 버전. 호출 시점에 `definitions.ACTIVE` 로 읽을 것(모듈 import 시 캡처 금지).
ACTIVE = "r1"

# 화면 라벨 (웹 RULE_LABEL 과 같아야 함 — vitest 가 대조)
RULE_LABELS: dict[str, str] = {
    "rating": "레이팅",
    "form": "최근 성적",
    "course": "거리 적성",
    "jockey": "기수",
    "trainer": "조교사",
}

# 정의 한 줄 (payload.rules[].definition 에 동결)
RULE_DEFINITIONS: dict[str, str] = {
    "rating": "출전표 레이팅이 높은 순서로 고릅니다.",
    "form": "최근 1년 안의 최근 3경주에서 3착 안에 든 횟수가 많은 순서로 고릅니다.",
    "course": "같은 경마장·같은 거리에서 3착 안에 든 비율이 높은 순서로 고릅니다.",
    "jockey": "기수의 최근 90일 같은 경마장 승률이 높은 순서로 고릅니다.",
    "trainer": "조교사의 최근 90일 같은 경마장 승률이 높은 순서로 고릅니다.",
}


def get(version: str) -> RuleSetDef:
    try:
        return RULE_SETS[version]
    except KeyError as e:  # pragma: no cover - 방어
        raise KeyError(f"unknown racing_form rules_version: {version!r}") from e


def active() -> RuleSetDef:
    """현재 ACTIVE 버전 정의 (호출 시점 조회)."""
    import sys

    mod = sys.modules[__name__]
    return get(mod.ACTIVE)


def definition_json(defn: RuleSetDef) -> str:
    """해시 대상 정규 JSON 문자열."""
    return json.dumps(defn.to_json_obj(), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def definition_sha256(defn: RuleSetDef) -> str:
    return hashlib.sha256(definition_json(defn).encode("utf-8")).hexdigest()
