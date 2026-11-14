"""경마지 문구 템플릿 렌더링 + 금지어·기호 글리프 검사.

- 문구 템플릿은 `definitions` 의 `params["wording"]` 에만 둔다 → 정의 해시로 고정된다.
- 금지어 정본은 `data/forbidden_words.json`
  (웹 `racing_form-shared.ts` 의 FORBIDDEN_WORDS 와 같아야 함).
  이 패키지 기준 상대 경로로 읽는다 (Docker 이미지에는 crawler/src 만 복사된다).
- 금지어·글리프 검사는 근거·소식 문장에만 쓴다 (고지문의 "보장하지 않습니다" 와 충돌 방지).
  ▲▼ 는 증감 부호라 금지 글리프가 아니다 (rating_change 배지).
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from .definitions import RuleSetDef

FORBIDDEN_PATH: Path = Path(__file__).resolve().parent / "data" / "forbidden_words.json"

_PLACEHOLDER_RE = re.compile(r"\{[^{}]*\}")


def render(defn: RuleSetDef, key: str, **kw: Any) -> str:
    """`defn.params["wording"][key]` 를 str.format 으로 채운다 (빠진 자리표시자는 KeyError)."""
    template = defn.p("wording", key)
    if not isinstance(template, str):
        raise TypeError(f"wording[{key!r}] is not a string")
    return template.format(**kw)


@lru_cache(maxsize=1)
def _load() -> tuple[tuple[str, ...], tuple[str, ...]]:
    data = json.loads(FORBIDDEN_PATH.read_text(encoding="utf-8"))
    words = tuple(str(w) for w in data["words"])
    glyphs = tuple(str(g) for g in data["glyphs"])
    return words, glyphs


def forbidden_words() -> tuple[str, ...]:
    """평가어·권유어 목록 (정본 JSON 순서)."""
    return _load()[0]


def forbidden_glyphs() -> tuple[str, ...]:
    """근거·소식 문장에 쓰지 않는 기호 글리프 (◎○△)."""
    return _load()[1]


def find_forbidden(text: str) -> list[str]:
    """text 에 들어 있는 금지어·글리프 (목록 순서, 중복 없음). 없으면 []."""
    words, glyphs = _load()
    return [w for w in (*words, *glyphs) if w in text]


def is_clean(text: str) -> bool:
    return not find_forbidden(text)


def assert_clean(text: str, context: str = "") -> None:
    """금지어·글리프가 있으면 ValueError."""
    found = find_forbidden(text)
    if found:
        where = f" ({context})" if context else ""
        raise ValueError(f"금지어·기호 포함{where}: {found} — {text!r}")


def template_violations(defn: RuleSetDef) -> list[str]:
    """wording 템플릿(자리표시자 제외 고정 문구)에 든 금지어·글리프 → ["key: 단어", ...]."""
    out: list[str] = []
    wording = defn.p("wording")
    for key in sorted(wording):
        fixed = _PLACEHOLDER_RE.sub("", str(wording[key]))
        out.extend(f"{key}: {w}" for w in find_forbidden(fixed))
    return out
