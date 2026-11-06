"""src.redact — API 키 마스킹 단위 테스트."""
from __future__ import annotations

import io
import logging

import httpx
import pytest

from src.redact import redact

KEY_ENC = "AbC123%2BxYz%2F9%3D%3D"  # URL 인코딩된 data.go.kr 키
KEY_RAW = "AbC123+xYz/9=="  # 디코딩 키


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            f"https://apis.data.go.kr/B551015/API4?serviceKey={KEY_ENC}&pageNo=1",
            "https://apis.data.go.kr/B551015/API4?serviceKey=***&pageNo=1",
        ),
        (
            f"https://apis.data.go.kr/x?pageNo=1&serviceKey={KEY_RAW}",
            "https://apis.data.go.kr/x?pageNo=1&serviceKey=***",
        ),
        (f"?ServiceKey={KEY_ENC}", "?ServiceKey=***"),
        (f"?servicekey={KEY_RAW} trailing", "?servicekey=*** trailing"),
        (
            "https://www.googleapis.com/youtube/v3/search?part=snippet&key=AIzaSyD-abc_123",
            "https://www.googleapis.com/youtube/v3/search?part=snippet&key=***",
        ),
        ("?apiKey=abc123&x=1", "?apiKey=***&x=1"),
        ("?api_key=abc123", "?api_key=***"),
        # URL 전체가 한 번 더 인코딩된 경우 (redirect param 등)
        (f"next=%3FserviceKey%3D{KEY_ENC}%26pageNo%3D1", "next=%3FserviceKey%3D***%26pageNo%3D1"),
        # dict / JSON repr
        (f"{{'serviceKey': '{KEY_RAW}', 'pageNo': 1}}", "{'serviceKey': '***', 'pageNo': 1}"),
        ('{"key": "AIzaSyD-abc"}', '{"key": "***"}'),
        # 따옴표로 감싼 URL — 따옴표에서 끊겨야 함
        (f"'https://h/x?serviceKey={KEY_ENC}'", "'https://h/x?serviceKey=***'"),
    ],
)
def test_redact_masks_keys(text: str, expected: str) -> None:
    assert redact(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "",
        "monkey=banana&pageKey=abc&cache_key=zz",
        "KeyError: 'rcDate'",
        "keyword=경마",
        "no secrets here",
    ],
)
def test_redact_leaves_other_text(text: str) -> None:
    assert redact(text) == text


def test_redact_http_status_error_message() -> None:
    # httpx 가 실제로 만드는 4xx/5xx 메시지 형식 그대로 검증.
    req = httpx.Request(
        "GET",
        "https://apis.data.go.kr/B551015/API4_3/raceResult_3",
        params={"serviceKey": KEY_RAW, "pageNo": 1, "_type": "json"},
    )
    resp = httpx.Response(500, request=req)
    with pytest.raises(httpx.HTTPStatusError) as ei:
        resp.raise_for_status()
    msg = redact(f"{type(ei.value).__name__}: {ei.value}")
    assert "serviceKey=***" in msg
    assert "AbC123" not in msg
    assert "pageNo=1" in msg


def test_configure_logging_masks_and_quiets(capsys: pytest.CaptureFixture[str]) -> None:
    from src.logging import _RedactingFormatter, configure_logging, get_logger

    configure_logging()
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING
    assert logging.getLogger("apscheduler").getEffectiveLevel() == logging.WARNING
    assert logging.getLogger("apscheduler.scheduler").getEffectiveLevel() == logging.WARNING

    # structlog 경로 — err=str(exc) 류
    get_logger("t").warning("fetch_failed", err=f"500 for url ?serviceKey={KEY_ENC}&x=1")
    out = capsys.readouterr().out
    assert "serviceKey=***" in out
    assert "AbC123" not in out

    # stdlib 경로 — traceback 포함
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(_RedactingFormatter("%(message)s"))
    lg = logging.getLogger("t.stdlib")
    lg.addHandler(h)
    try:
        try:
            raise RuntimeError(f"boom https://x/?key={KEY_RAW}")
        except RuntimeError:
            lg.exception("job raised")
    finally:
        lg.removeHandler(h)
    assert "key=***" in buf.getvalue()
    assert "AbC123" not in buf.getvalue()
