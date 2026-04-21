# syntax=docker/dockerfile:1.6
# mal 크롤러 (Python 3.12 + uv, KRA OpenAPI / RSS / YouTube).
# Build context = 모노레포 루트(..) — crawler/core 를 editable 로 설치하기 위함.

FROM python:3.12-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_LINK_MODE=copy

# uv 만 최소 설치
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

WORKDIR /app

# crawler-core 를 먼저 카피 — pyproject.toml 의 `../../crawler/core` 경로가 가리키는 위치.
# /app 에서 상대적으로 `../../crawler/core` = /crawler/core 가 되도록 배치한다.
COPY crawler/core /crawler/core

# deps layer — lockfile 기반 reproducible install
COPY mal/crawler/pyproject.toml mal/crawler/uv.lock* ./
RUN uv sync --no-dev --no-install-project --frozen || uv sync --no-dev --no-install-project

# 앱 코드
COPY mal/crawler/src ./src
COPY mal/crawler/README.md* ./

# non-root
RUN useradd -r -s /usr/sbin/nologin app && chown -R app:app /app /crawler
USER app

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONPATH=/app

# src/scheduler_main.py 가 APScheduler(BlockingScheduler) 를 돌린다 — 호스트 systemd
# timer 의존성 제거. 기존 systemd/*.timer 스펙을 그대로 KST CronTrigger 로 이식함.
# @track_job 이 run 을 대시보드에 기록하므로 추가 훅 불필요.
# 수동/일회성 명령 (backfill-history, sync-horse-no 등) 은 `docker exec mal-crawler
# python -m src.main <cmd>` 형태로 여전히 호출 가능.
CMD ["sh", "-c", "python -m src.main register-dashboard-jobs || true; exec python -m src.scheduler_main"]
