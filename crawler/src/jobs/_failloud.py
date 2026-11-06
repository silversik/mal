"""단위(meet/날짜/관측소/키워드 …) 루프의 "조용한 0건 success" 방지.

단위별 예외를 warning 으로 넘기는 루프는 모든 단위가 실패해도 0 을 반환하고
@track_job 이 success 로 기록한다 (승인 만료·한도·API 변경을 못 잡음 — 4/25
race_entries 사고와 같은 경로). 시도한 단위가 **전부** 예외면 RuntimeError.
일부 실패는 경고만(부분 데이터 성공), 예외 없이 0건인 단위는 정상.
"""
from __future__ import annotations

from typing import Any

from ..clients.kra_base import is_kra_no_data
from ..logging import get_logger
from ..redact import redact

__all__ = ["UnitFailures", "is_kra_no_data"]

log = get_logger(__name__)


class UnitFailures:
    """시도/실패 단위 카운터. 루프 뒤 `raise_if_all_failed()` 호출."""

    def __init__(self, job: str) -> None:
        self.job = job
        self.attempted = 0
        self.failed = 0
        self.first_error: str | None = None

    def ok(self) -> None:
        self.attempted += 1

    def fail(self, exc: BaseException, event: str, **ctx: Any) -> None:
        """단위 실패 기록 + 기존과 같은 warning 로그. KRA NODATA 는 성공(0건)으로 센다."""
        if is_kra_no_data(exc):
            self.ok()
            log.info(f"{event}_no_data", **ctx)
            return
        self.attempted += 1
        self.failed += 1
        if self.first_error is None:
            self.first_error = f"{type(exc).__name__}: {exc}"
        log.warning(event, err=str(exc), **ctx)

    def raise_if_all_failed(self) -> None:
        if self.attempted and self.failed == self.attempted:
            first = redact(self.first_error or "")[:200]
            raise RuntimeError(
                f"{self.job}: 시도한 {self.attempted}개 단위 전부 실패 — 첫 오류: {first}"
            )
