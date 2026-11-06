"""crawler 단위 테스트 공통 설정."""
from __future__ import annotations

import os

# src.db 가 import 시점에 engine 을 만든다 (connect 는 lazy) — 실DB 접속 없음.
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:1/test")
# KraClient 는 빈 키를 거부 — 테스트는 클라이언트를 mock 하므로 더미 값.
os.environ.setdefault("KRA_SERVICE_KEY", "dummy-test-key")
