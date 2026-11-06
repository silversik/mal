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


def test_expected_interval_margin_rule(monitoring: tuple[Any, list[dict]]) -> None:
    mod, _ = monitoring
    h, d = 3600, 86400
    # ≤4h 주기 → +1h, 그 이상 +25%, 상한 +1일
    assert mod._expected_interval(30 * 60) == 30 * 60 + h
    assert mod._expected_interval(3 * h) == 4 * h
    assert mod._expected_interval(d) == 30 * h
    assert mod._expected_interval(7 * d) == 8 * d
    # 3h interval job 들이 여유 0 으로 남지 않았는지
    for key in ("mal.sync_race_entries", "mal.backfill_races_from_entries", "mal.sync_videos"):
        assert mod.JOB_CATALOG[key]["expected_interval_sec"] == 4 * h
    for spec in mod.JOB_CATALOG.values():
        assert isinstance(spec["expected_interval_sec"], int)
