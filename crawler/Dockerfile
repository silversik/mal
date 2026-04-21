# syntax=docker/dockerfile:1.6
# mal 크롤러 (Python 3.12 + uv, KRA OpenAPI / RSS / YouTube).
# Build context = ./crawler

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

# deps layer — lockfile 기반 reproducible install
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --no-install-project --frozen || uv sync --no-dev --no-install-project

# 앱 코드
COPY src ./src
COPY README.md* ./

# non-root
RUN useradd -r -s /usr/sbin/nologin app && chown -R app:app /app
USER app

ENV PATH=/app/.venv/bin:$PATH \
    PYTHONPATH=/app

# main.py 는 typer CLI — 단발성 명령을 호출하는 구조라 자체 스케줄러 루프가 없다.
# 컨테이너는 유지해두고 호스트 cron 이 `docker exec mal-crawler python -m src.main periodic-*`
# 형태로 트리거한다. 추후 crawler.core 스케줄러 도입 시 CMD 를 그걸로 교체.
CMD ["sleep", "infinity"]
