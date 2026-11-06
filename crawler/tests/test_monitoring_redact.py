"""@track_job 실패 리포트(대시보드·Telegram)에 API 키가 실리지 않는지 검증."""
from __future__ import annotations

import importlib
import sys
import types
from typing import Any

import httpx
import pytest


@pytest.fixture
def monitoring(monkeypatch: pytest.MonkeyPatch) -> tuple[Any, list[dict]]:
    # crawler_core(sibling 레포) 는 테스트 환경에 없을 수 있어 가짜 모듈로 대체.
    calls: list[dict] = []
    client = types.SimpleNamespace(
        safe_register=lambda **kw: None,
        safe_start_run=lambda job_key: 1,
        safe_finish_run=lambda run_id, **kw: calls.append(kw),
    )
    pkg = types.ModuleType("crawler_core")
    pkg.client = client  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "crawler_core", pkg)
    monkeypatch.setitem(sys.modules, "crawler_core.client", client)  # type: ignore[arg-type]
    monkeypatch.delitem(sys.modules, "src.monitoring", raising=False)
    return importlib.import_module("src.monitoring"), calls


def test_failed_run_error_message_is_redacted(monitoring: tuple[Any, list[dict]]) -> None:
    mod, calls = monitoring

    @mod.track_job("mal.sync_videos")
    def job() -> int:
        req = httpx.Request(
            "GET",
            "https://www.googleapis.com/youtube/v3/search",
            params={"part": "snippet", "key": "AIzaSySECRET%2Bvalue"},
        )
        httpx.Response(403, request=req).raise_for_status()
        return 0

    with pytest.raises(httpx.HTTPStatusError):
        job()

    assert len(calls) == 1
    msg = calls[0]["error_message"]
    assert calls[0]["status"] == "failed"
    assert "key=***" in msg
    assert "SECRET" not in msg
    assert "HTTPStatusError" in msg
