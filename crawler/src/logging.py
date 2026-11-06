"""Structured logging setup using structlog."""
from __future__ import annotations

import logging
from typing import Any

import structlog

from .config import settings
from .redact import redact

# 요청 URL(serviceKey/key 포함)을 INFO 로 찍는 라이브러리 — LOG_LEVEL 과 무관하게 WARNING 고정.
# apscheduler.* 하위 로거는 부모 레벨을 따른다.
_NOISY_LOGGERS = ("httpx", "httpcore", "apscheduler")


class _RedactingFormatter(logging.Formatter):
    """stdlib 로그(traceback 포함) 최종 문자열에서 API 키 마스킹."""

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


class _RedactingRenderer:
    """structlog 최종 렌더 결과에서 API 키 마스킹 — `err=str(exc)` 류 호출부 일괄 커버."""

    def __init__(self, renderer: Any) -> None:
        self._renderer = renderer

    def __call__(self, logger: Any, method_name: str, event_dict: Any) -> str:
        return redact(self._renderer(logger, method_name, event_dict))


def configure_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(_RedactingFormatter("%(message)s"))
    # force=True — crawler_core 나 import 부수효과로 root 에 핸들러가 먼저 붙어 있으면
    # basicConfig 는 no-op 이 되어 마스킹 formatter 가 설치되지 않는다. 기존 핸들러를 걷어내고 교체.
    logging.basicConfig(level=level, handlers=[handler], force=True)
    for name in _NOISY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            # rich 가 설치돼 있으면 ConsoleRenderer 기본 exception_formatter 는
            # RichTracebackFormatter(show_locals=True) — 프레임 locals(params dict 등)에 키가 실리고
            # ANSI 코드·문자열 truncate 로 사후 정규식 마스킹이 빗나간다.
            # plain traceback(locals 없음) + colors=False 로 평문을 만든 뒤 마스킹.
            _RedactingRenderer(
                structlog.dev.ConsoleRenderer(
                    colors=False,
                    exception_formatter=structlog.dev.plain_traceback,
                )
            ),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
