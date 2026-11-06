"""API 키 마스킹 — 로그·대시보드·Telegram 으로 나가는 문자열에서 키 값을 가린다.

KRA/KMA 는 `serviceKey`, YouTube 는 `key` 를 query string 에 실어 보내므로
httpx 요청 로그나 `HTTPStatusError` 메시지(전체 URL 포함)에 키가 그대로 노출된다.
"""
from __future__ import annotations

import re

MASK = "***"

# 마스킹 대상 파라미터명 (대소문자 무시).
_NAMES = r"(?:servicekey|api_key|apikey|key)"

# 이름 앞 경계 — 영숫자/_ 가 아니거나 인코딩된 `?`/`&` 뒤. `monkey=` / `pageKey=` 오탐 방지.
_START = r"(?:(?<![A-Za-z0-9_])|(?<=%3F)|(?<=%26))"

# 키 값으로 올 수 있는 문자 — base64(+/=) · URL 인코딩(%2B) · hex · 토큰류.
# `&`·공백·따옴표·ANSI escape 등에서, 이중 인코딩 URL 이면 `%26`(&) 에서 끊긴다.
_VALUE = r"(?:(?!%26)[A-Za-z0-9%+/=._~-])+"

# serviceKey=xxx / key%3Dxxx (URL 전체가 한 번 더 인코딩된 경우)
_QUERY_RE = re.compile(rf"(?i){_START}({_NAMES})(=|%3D)({_VALUE})")
# dict/JSON repr — 'serviceKey': 'xxx' / "key": "xxx"
_MAPPING_RE = re.compile(rf"""(?i)(['"])({_NAMES})\1(\s*:\s*)(['"])[^'"]*\4""")


def redact(text: str) -> str:
    """문자열 안의 API 키 값을 `***` 로 치환."""
    if not text:
        return text
    text = _QUERY_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{MASK}", text)
    text = _MAPPING_RE.sub(
        lambda m: f"{m.group(1)}{m.group(2)}{m.group(1)}{m.group(3)}{m.group(4)}{MASK}{m.group(4)}",
        text,
    )
    return text
