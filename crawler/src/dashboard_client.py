"""통합 크롤러 대시보드 HTTP 리포트 클라이언트 (mal crawler).

crawler 레포의 `core/crawler_core/client.py` 축약 버전 — vendored.
대시보드 API 스펙이 바뀌면 두 곳 모두 동기화 필요.

환경 변수:
    DASHBOARD_URL       — 기본 http://crawler-dashboard:3100
    CRAWLER_SECRET      — X-Crawler-Secret 헤더
"""
from __future__ import annotations

import logging
import os
from typing import Any

import httpx

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _base_url() -> str:
    return os.environ.get("DASHBOARD_URL", "http://crawler-dashboard:3100").rstrip("/")


def _headers() -> dict[str, str]:
    secret = os.environ.get("CRAWLER_SECRET")
    if not secret:
        raise RuntimeError("CRAWLER_SECRET env var missing")
    return {"X-Crawler-Secret": secret, "Content-Type": "application/json"}


def register_job(
    *,
    job_key: str,
    service: str = "mal",
    category: str | None = None,
    description: str | None = None,
    expected_interval_sec: int = 3600,
    enabled: bool = True,
) -> None:
    payload = {
        "job_key": job_key,
        "service": service,
        "category": category,
        "description": description,
        "expected_interval_sec": expected_interval_sec,
        "enabled": enabled,
    }
    with httpx.Client(timeout=_TIMEOUT) as c:
        r = c.post(f"{_base_url()}/api/jobs/register", headers=_headers(), json=payload)
        r.raise_for_status()


def start_run(job_key: str):
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.post(
                f"{_base_url()}/api/runs/start",
                headers=_headers(),
                json={"job_key": job_key},
            )
            r.raise_for_status()
            return int(r.json()["run_id"])
    except Exception as e:
        log.warning("dashboard start_run(%s) failed: %s", job_key, e)
        return None


def finish_run(run_id, *, status: str, rows_upserted: int | None = None, error_message: str | None = None) -> None:
    if run_id is None:
        return
    payload: dict[str, Any] = {"status": status}
    if rows_upserted is not None:
        payload["rows_upserted"] = rows_upserted
    if error_message is not None:
        payload["error_message"] = error_message
    try:
        with httpx.Client(timeout=_TIMEOUT) as c:
            r = c.post(f"{_base_url()}/api/runs/{run_id}/finish", headers=_headers(), json=payload)
            r.raise_for_status()
    except Exception as e:
        log.warning("dashboard finish_run(%s) failed: %s", run_id, e)


def safe_register(**kw):
    try:
        register_job(**kw)
    except Exception as e:
        log.warning("dashboard register_job failed: %s", e)
